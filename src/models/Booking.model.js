const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Ticket",
    required: true,
  },
  quantity: { type: Number, required: true },
  status: {
    type: String,
    enum: ["pending", "paid", "confirmed", "canceled"],
    default: "pending",
  },
  paymentDetails: {
    amount: { type: Number, default: 0 },
    paymentTime: { type: Date },
  },
  bookingTime: { type: Date, default: Date.now },
  confirmationTime: { type: Date },
});

BookingSchema.index({ bookingTime: 1 });
BookingSchema.index({ status: 1 });

module.exports = mongoose.model("Booking", BookingSchema);
