const express = require("express");

const {
  bookTicket,
  confirmBooking,
  cancelBooking,
  getBookings,getBookingDetails
} = require("../controllers/Booking.controller");

const bookingRouter = express.Router();

bookingRouter.get("/get-bookings", getBookings);
bookingRouter.get("/booking-details/:id", getBookingDetails);
bookingRouter.post("/book-ticket", bookTicket);
bookingRouter.put("/confirm", confirmBooking);
// 
bookingRouter.post("/cancel", cancelBooking);

module.exports = bookingRouter;
