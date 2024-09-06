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

//  only admin
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
  session.startTransaction(); // Bắt đầu transaction

  try {
    const { bookingId, paymentDetails } = req.body;

    // Lấy thông tin booking cùng với thông tin ticket và user
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

    // Kiểm tra xem booking đã được thanh toán hoặc xác nhận chưa
    if (booking.status === "confirmed" || booking.status === "paid") {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Booking already processed", 400));
    }

    // Kiểm tra số tiền thanh toán có chính xác không
    const totalAmount = booking.ticket.price * booking.quantity;
    if (paymentDetails.amount !== totalAmount) {
      await session.abortTransaction();
      session.endSession();
      return next(
        new ErrorHandler("Incorrect payment amount. Please try again.", 400)
      );
    }

    // Kiểm tra số dư của người dùng
    if (booking.user.balance < paymentDetails.amount) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler("Insufficient balance", 400));
    }

    try {
      // Cập nhật thông tin booking và trạng thái thanh toán
      booking.paymentDetails = {
        ...paymentDetails,
        paymentTime: Date.now(),
      };
      booking.status = "paid";
      booking.confirmationTime = Date.now();

      // Cập nhật số dư của người dùng
      booking.user.balance -= paymentDetails.amount;
      await booking.user.save({ session });

      // Cập nhật số lượng vé
      booking.ticket.quantity -= booking.quantity;
      booking.ticket.available = booking.ticket.quantity > 0;
      await booking.ticket.save({ session });

      // Lưu thông tin booking
      await booking.save({ session });

      // Hoàn tất transaction
      await session.commitTransaction();
      session.endSession();

      return res
        .status(200)
        .json({ success: true, message: "Payment has been successful" });
    } catch (error) {
      // Nếu có lỗi, hủy bỏ transaction
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorHandler(error?.message, 500));
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(new ErrorHandler(error?.message, 500));
  }
});

// exports.payForTicket = catchAsyncError(async (req, res, next) => {
//   try {
//     const { bookingId, paymentDetails } = req.body;

//     // Tìm booking
//     const booking = await Booking.findById(bookingId)
//       .populate("ticket")
//       .populate("user");

//     // Kiểm tra nếu booking đã được xác nhận và thanh toán
//     if (!booking) {
//       return next(new ErrorHandler("Booking not found", 404));
//     }

//     if (booking.isConfirmed || booking.status === "paid") {
//       return next(new ErrorHandler("Booking already paid", 400));
//     }

//     // Cập nhật thông tin thanh toán
//     booking.paymentDetails = {
//       ...paymentDetails,
//       paymentTime: Date.now(),
//     };
//     booking.status = "paid";
//     booking.confirmationTime = Date.now();

//     // Cập nhật ticket quantity và available
//     const ticket = await Ticket.findById(booking.ticket);
//     ticket.quantity -= booking.quantity;
//     ticket.available = ticket.quantity > 0;
//     await ticket.save();

//     // Cập nhật số dư tài khoản người dùng
//     const user = await User.findById(booking.user._id);
//     user.balance -= booking.paymentDetails.amount;
//     await user.save();

//     // Lưu booking
//     await booking.save();

//     res.status(200).json({
//       success: true,
//       message: "Payment has been successful",
//     });
//   } catch (error) {
//     return next(new ErrorHandler(error?.message, 500));
//   }
// });
