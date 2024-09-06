const { catchAsyncError } = require("../middleware/catchAsyncError");
const { ErrorHandler } = require("../utils/ErrorHandler");

const Booking = require("../models/Booking.model");
const Ticket = require("../models/Ticket.model");
const User = require("../models/User.model");
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
//

exports.bookTicket = catchAsyncError(async (req, res, next) => {
  const session = await mongoose.startSession(); // Bắt đầu phiên giao dịch
  session.startTransaction(); // Bắt đầu transaction

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

    // Kiểm tra nếu user đã có booking hợp lệ cho ticket này
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

    // Kiểm tra nếu có booking đã bị hủy
    const canceledBooking = await Booking.findOne({
      user: userId,
      ticket: ticketId,
      status: "canceled",
    })
      .session(session)
      .exec();

    if (canceledBooking) {
      // Khôi phục booking đã hủy
      const newTotalAmount = ticket.price * quantity;

      canceledBooking.status = "pending";
      canceledBooking.quantity = quantity;
      canceledBooking.paymentDetails.amount = newTotalAmount;
      canceledBooking.bookingTime = Date.now();
      await canceledBooking.save({ session });

      // // Cập nhật số lượng vé
      // ticket.quantity -= quantity;
      // ticket.available = ticket.quantity > 0;
      // await ticket.save({ session });

      await session.commitTransaction(); // Hoàn tất transaction
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Booking restored successfully",
        bookingId: canceledBooking._id,
      });
    }

    // Tạo mới booking
    const totalAmount = ticket.price * quantity;
    const newBooking = await Booking.create(
      [
        {
          user: userId,
          ticket: ticketId,
          quantity,
          paymentDetails: { amount: totalAmount },
          bookingTime: Date.now(),
          status: "pending",
        },
      ],
      { session }
    );

    // // Cập nhật số lượng vé sau khi tạo booking
    // ticket.quantity -= quantity;
    // ticket.available = ticket.quantity > 0;
    // await ticket.save({ session });

    await session.commitTransaction(); // Hoàn tất transaction
    session.endSession();

    return res.status(201).json({
      success: true,
      message: "Booking created successfully",
      bookingId: newBooking[0]._id,
    });
  } catch (error) {
    await session.abortTransaction(); // Hủy transaction nếu có lỗi
    session.endSession();
    return next(new ErrorHandler("Failed to book ticket", 500));
  }
});

// exports.bookTicket = catchAsyncError(async (req, res, next) => {
//   try {
//     const { userId, ticketId, quantity } = req.body;

//     if (!userId || !ticketId || quantity === undefined) {
//       return next(new ErrorHandler("Please provide all required fields", 400));
//     }

//     const ticket = await Ticket.findById(ticketId);
//     if (!ticket) {
//       return next(new ErrorHandler("Ticket not found", 404));
//     }

//     if (ticket.quantity < quantity) {
//       return next(new ErrorHandler("Not enough tickets available", 400));
//     }

//     const user = await User.findById(userId);
//     if (!user) {
//       return next(new ErrorHandler("User not found", 404));
//     }

//     // Start a session for atomic operations
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       // Check if the user has already booked this ticket
//       const existingBooking = await Booking.findOne({
//         "user._id": userId,
//         "ticket._id": ticketId,
//         status: { $ne: "canceled" },
//       }).session(session);
//       if (existingBooking) {
//         await session.abortTransaction();
//         session.endSession();
//         return next(
//           new ErrorHandler("User has already booked this ticket", 400)
//         );
//       }

//       // Create a new booking
//       const amount = ticket.price * quantity;
//       const newBooking = {
//         user: { _id: userId, username: user.username, email: user.email },
//         ticket: { _id: ticketId, name: ticket.name, price: ticket.price },
//         paymentDetails: { amount },
//         bookingTime: Date.now(),
//         quantity,
//         status: "pending",
//       };

//       const booking = await Booking.create([newBooking], { session });
//       ticket.bookings.push(booking[0]._id);
//       ticket.quantity -= quantity;
//       ticket.available = ticket.quantity > 0;

//       await ticket.save({ session });
//       await session.commitTransaction();
//       session.endSession();

//       res.status(201).json({
//         success: true,
//         message: "Booking saved successfully",
//         bookingId: booking[0]._id,
//       });
//     } catch (error) {
//       await session.abortTransaction();
//       session.endSession();
//       return next(new ErrorHandler(error?.message, 500));
//     }
//   } catch (error) {
//     return next(new ErrorHandler(error?.message, 500));
//   }
// });

exports.confirmBooking = catchAsyncError(async (req, res, next) => {
  try {
    const { bookingId } = req.body;

    const booking = await Booking.findById(bookingId)
      .populate("ticket")
      .populate("user");

    if (!booking) {
      return next(new ErrorHandler("Booking not found", 404));
    }

    if (booking.status === "confirmed") {
      return next(new ErrorHandler("Booking already confirmed", 400));
    }

    if (booking.status !== "confirmed" && booking.status !== "paid") {
      return next(new ErrorHandler("Booking has not been paid yet", 400));
    }

    booking.status = "confirmed";
    booking.confirmationTime = Date.now();
    await booking.save();

    const ticket = await Ticket.findById(booking.ticket);
    if (
      ticket &&
      ticket.bookings.find(
        (b) => b._id.toString() === bookingId && b.isConfirmed
      )
    ) {
      ticket.quantity -= booking.quantity;
      ticket.available = ticket.quantity > 0;
      ticket.isConfirmed = true;
      ticket.status = "paid";
      await ticket.save();
    }

    const bookingIndex = ticket.bookings.findIndex(
      (b) => b._id.toString() === bookingId
    );

    if (bookingIndex > -1) {
      ticket.bookings[bookingIndex].isConfirmed = true;
      ticket.bookings[bookingIndex].status = "paid";
      await ticket.save();
    } else {
      return next(
        new ErrorHandler("Booking not found in ticket bookings", 404)
      );
    }

    res.status(201).json({
      success: true,
      booking,
    });
  } catch (error) {
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

//
exports.cancelBooking = catchAsyncError(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction(); // Bắt đầu transaction

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
      // // Cập nhật số lượng vé
      // ticket.quantity += booking.quantity;
      // ticket.available = ticket.quantity > 0;
      // await ticket.save({ session });

      // Cập nhật trạng thái booking
      booking.status = "canceled";
      await booking.save({ session });

      await session.commitTransaction(); // Hoàn tất transaction
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Booking canceled successfully",
      });
    }
    if (booking.status === "paid") {
      // Cập nhật số lượng vé
      ticket.quantity += booking.quantity;
      ticket.available = ticket.quantity > 0;
      await ticket.save({ session });

      // Cập nhật trạng thái booking
      booking.status = "canceled";
      await booking.save({ session });

      // refund
      const refundAmount = booking.paymentDetails.amount;
      const user = await User.findById(booking.user._id).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return next(new ErrorHandler("User not found", 404));
      }

      // Cập nhật số dư của người dùng (hoàn tiền)
      user.balance += refundAmount;
      await user.save({ session });

      await session.commitTransaction(); // Hoàn tất transaction
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Booking canceled successfully",
      });
    } else if (booking.status === "confirmed") {
      // Tính toán số tiền hoàn lại (90%)
      const refundAmount = booking.paymentDetails.amount * 0.9;

      const user = await User.findById(booking.user._id).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return next(new ErrorHandler("User not found", 404));
      }

      // Cập nhật số dư của người dùng (hoàn tiền)
      user.balance += refundAmount;
      await user.save({ session });

      // Cập nhật số lượng vé
      ticket.quantity += booking.quantity;
      ticket.available = ticket.quantity > 0;
      await ticket.save({ session });

      // Cập nhật trạng thái booking thành "canceled"
      booking.status = "canceled";
      await booking.save({ session });

      await session.commitTransaction(); // Hoàn tất transaction
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

// Auto-cancel: If a booking is not confirmed within the time frame, it will canceled automatically.
cron.schedule("* * * * *", async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  try {
    const bookings = await Booking.find({
      status: "pending",
      bookingTime: { $lt: fiveMinutesAgo },
    });
    for (const booking of bookings) {
      booking.status = "canceled";
      await booking.save();
    }
  } catch (err) {
    console.error(err);
  }
});

cron.schedule("*/1 * * * *", async () => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const pendingBookings = await Booking.find({
      status: { $in: ["pending", "paid"] },
      bookingTime: { $lt: fiveMinutesAgo },
    });

    for (const booking of pendingBookings) {
      const user = await User.findById(booking.user);
      const ticket = await Ticket.findById(booking.ticket);

      if (booking.status === "paid") {
        console.log(
          `Refunding user: ${user._id}, current balance: ${user.balance}`
        );
        // Hoàn tiền nếu đã thanh toán
        user.balance += booking.paymentDetails.amount;
        await user.save();

        // Cập nhật số lượng vé
        ticket.quantity += booking.quantity;
        ticket.available = ticket.quantity > 0;
        await ticket.save();

        console.log(`User ${user._id} refunded, new balance: ${user.balance}`);
      }

      // Cập nhật trạng thái booking thành 'canceled'
      booking.status = "canceled";
      await booking.save();
      console.log(`Booking ${booking._id} canceled`);
    }
  } catch (error) {
    // Notification
    return next(new ErrorHandler(error?.message, 500));
  }
});
