const { catchAsyncError } = require("../middleware/catchAsyncError");
const { ErrorHandler } = require("../utils/ErrorHandler");

const Booking = require("../models/Booking.model");
const Ticket = require("../models/Ticket.model");
const User = require("../models/User.model");
const cron = require("node-cron");
const mongoose = require("mongoose");

exports.getBookings = catchAsyncError(async (req, res, next) => {
  try {
    const bookings = await Booking.find();

    res.status(201).json({ success: true, bookings });
  } catch (error) {
    return next(new ErrorHandler(error?.message, 500));
  }
});


exports.bookTicket = catchAsyncError(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, ticketId, quantity } = req.body;

    if (!userId || !ticketId || quantity === undefined) {
      return next(new ErrorHandler("Please provide all required fields", 400));
    }

    const ticket = await Ticket.findById(ticketId).session(session);
    if (!ticket) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Ticket not found", 404));
    }

    if (ticket.quantity < quantity) {
      return next(new ErrorHandler("Not enough tickets available", 400));
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    const existingBooking = await Booking.findOne({
      user: userId,
      ticket: ticketId,
      status: { $in: ["pending", "paid", "confirmed"] },
    })
      .session(session)
      .exec();

    if (existingBooking) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("You have already booked this ticket", 400));
    }

    const canceledBooking = await Booking.findOne({
      user: userId,
      ticket: ticketId,
      status: "canceled",
    })
      .session(session)
      .exec();

    if (canceledBooking) {
      const newTotalAmount = ticket.price * quantity;

      canceledBooking.status = "pending";
      canceledBooking.quantity = quantity;
      canceledBooking.paymentDetails.amount = newTotalAmount;
      canceledBooking.bookingTime = Date.now();
      await canceledBooking.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Booking restored successfully",
        bookingId: canceledBooking._id,
      });
    }

    const totalAmount = ticket.price * quantity;
    const newBooking = {
      user: userId,
      ticket: ticketId,
      quantity,
      paymentDetails: { amount: totalAmount },
      bookingTime: Date.now(),
      status: "pending",
    };

    const booking = await Booking.create([newBooking], { session });

    ticket.bookings.push(booking[0]._id);
    await ticket.save();

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: "Booking created successfully",
      bookingId: booking[0]._id,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(new ErrorHandler("Failed to book ticket", 500));
  }
});

exports.confirmBooking = catchAsyncError(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;

    const booking = await Booking.findById(bookingId)
      .populate("ticket")
      .populate("user")
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking not found", 404));
    }

    if (booking.status === "confirmed") {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking already confirmed", 400));
    }

    if (booking.status !== "paid") {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking has not been paid yet", 400));
    }

    if (booking.status === "canceled") {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking canceled", 400));
    }

    booking.status = "confirmed";
    booking.confirmationTime = Date.now();
    await booking.save({ session });

    const ticket = await Ticket.findById(booking.ticket._id).session(session);

    if (!ticket) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Ticket not found", 404));
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      booking,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(new ErrorHandler(error?.message, 500));
  }
});

exports.getBookingDetails = async (req, res, next) => {
  try {
    const bookingId = req.params.id;

    const booking = await Booking.findById(bookingId)
      .populate("user", "username email ")
      .populate("ticket", "name price");

    if (!booking) {
      return res.status(404).json({ msg: "Booking not found" });
    }

    res.status(200).json({
      success: true,
      booking,
    });
  } catch (error) {
    return next(new ErrorHandler(error?.message, 500));
  }
};

exports.cancelBooking = catchAsyncError(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { bookingId } = req.body;

    const booking = await Booking.findById(bookingId)
      .populate("ticket")
      .populate("user")
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking not found", 404));
    }

    if (booking.status === "canceled") {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking already canceled", 400));
    }

    const ticket = await Ticket.findById(booking.ticket._id).session(session);
    if (!ticket) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Ticket not found", 404));
    }

    if (booking.status === "pending") {
      booking.status = "canceled";
      await booking.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Booking canceled successfully",
      });
    }
    if (booking.status === "paid") {
      ticket.quantity += booking.quantity;
      ticket.available = ticket.quantity > 0;
      await ticket.save({ session });

      booking.status = "canceled";
      await booking.save({ session });

      const refundAmount = booking.paymentDetails.amount;
      const user = await User.findById(booking.user._id).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return next(new ErrorHandler("User not found", 404));
      }

      user.balance += refundAmount;
      await user.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Booking canceled successfully",
      });
    } else if (booking.status === "confirmed") {
      const refundAmount = booking.paymentDetails.amount * 0.9;

      const user = await User.findById(booking.user._id).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return next(new ErrorHandler("User not found", 404));
      }

      user.balance += refundAmount;
      await user.save({ session });

      ticket.quantity += booking.quantity;
      ticket.available = ticket.quantity > 0;
      await ticket.save({ session });

      booking.status = "canceled";
      await booking.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Booking canceled successfully, refund issued",
        refund: refundAmount,
      });
    } else {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking cannot be canceled", 400));
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(new ErrorHandler(error.message, 500));
  }
});

cron.schedule("*/1 * * * *", async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  try {
    const pendingOrPaidBookings = await Booking.find({
      status: { $in: ["pending", "paid"] },
      bookingTime: { $lt: fiveMinutesAgo },
    });

    for (const booking of pendingOrPaidBookings) {
      const user = await User.findById(booking.user);
      const ticket = await Ticket.findById(booking.ticket);

      if (booking.status === "paid") {
        console.log(
          `Refunding user: ${user._id}, current balance: ${user.balance}`
        );
        user.balance += booking.paymentDetails.amount;
        await user.save();

        ticket.quantity += booking.quantity;
        ticket.available = ticket.quantity > 0;
        await ticket.save();

        console.log(`User ${user._id} refunded, new balance: ${user.balance}`);
      }

      booking.status = "canceled";
      await booking.save();
      console.log(`Booking ${booking._id} canceled`);
    }
  } catch (error) {
    console.error("Error during cron job:", error);
  }
});
