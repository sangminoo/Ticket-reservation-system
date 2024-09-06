const mongoose = require("mongoose");

const TicketSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  available: { type: Boolean, default: true }, 
  bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }]
});


module.exports = mongoose.model('Ticket', TicketSchema);