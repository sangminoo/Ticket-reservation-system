const { catchAsyncError } = require("../middleware/catchAsyncError");
const { ErrorHandler } = require("../utils/ErrorHandler");
const User = require("../models/User.model");
const Booking = require("../models/Booking.model");
const Ticket = require("../models/Ticket.model");
const { default: mongoose } = require("mongoose");

exports.getUsers = catchAsyncError(async (req, res, next) => {
  try {
    const users = await User.find();
    res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    return next(new ErrorHandler(error?.message, 500));
  }
});

exports.addUser = catchAsyncError(async (req, res, next) => {
  try {
    const { username, email, balance } = req.body;

    if (!username || !email || balance === undefined) {
      return next(new ErrorHandler("Please enter the complete field", 400));
    }

    const user = await User.create({
      username,
      email,
      balance,
    });

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    return next(new ErrorHandler(error?.message, 500));
  }
});

exports.payForTicket = catchAsyncError(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId, paymentDetails } = req.body;

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
      return next(
        new ErrorHandler("This booking has been cancelled. Please rebook!", 400)
      );
    }

    if (booking.status === "confirmed" || booking.status === "paid") {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking already processed", 400));
    }

    const totalAmount = booking.ticket.price * booking.quantity;
    if (paymentDetails.amount !== totalAmount) {
      await session.abortTransaction();
      session.endSession();
      return next(
        new ErrorHandler("Incorrect payment amount. Please try again.", 400)
      );
    }

    if (booking.user.balance < paymentDetails.amount) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Insufficient balance", 400));
    }

    const updatedTicket = await Ticket.findOneAndUpdate(
      {
        _id: booking.ticket._id,
        quantity: { $gte: booking.quantity },
      },
      {
        $inc: { quantity: -booking.quantity },
        $set: { available: booking.ticket.quantity > booking.quantity },
      },
      { new: true, session }
    );

    if (!updatedTicket) {
      booking.status = "canceled";
      await booking.save({ session });

      await session.commitTransaction();
      session.endSession();

      return next(
        new ErrorHandler("Not enough tickets available, booking canceled", 400)
      );
    }

    booking.paymentDetails = {
      ...paymentDetails,
      paymentTime: Date.now(),
    };
    booking.status = "paid";
    booking.confirmationTime = Date.now();

    booking.user.balance -= paymentDetails.amount;
    await booking.user.save({ session });

    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res
      .status(200)
      .json({ success: true, message: "Payment has been successful" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(new ErrorHandler(error?.message, 500));
  }
});
