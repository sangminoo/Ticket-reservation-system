// controllers/ticketController.js
const { catchAsyncError } = require("../middleware/catchAsyncError");
const { ErrorHandler } = require('../utils/ErrorHandler');

const Ticket = require("../models/Ticket.model");
// Only admin
exports.createTicket = catchAsyncError(async (req, res, next) => {
  try {
    const { name, price, quantity } = req.body;

    if (!name || !price || !quantity) {
      return next(new ErrorHandler("Please provide all required fields", 400));
    }

    const newTicket = {
      name,
      price,
      quantity,
      available: quantity > 0,
    };

    const ticket = await Ticket.create(newTicket);

    await ticket.save();

    res.status(201).json({
      success: true,
      ticket, 
    });
  } catch (error) {
    return next(new ErrorHandler(error?.message, 500));
  }
});



exports.getAllTicketsAvailable = catchAsyncError(async (req, res, next) => {
  try {
    const tickets = await Ticket.find({available: true});
    res.status(200).json({
      success: true,
      tickets,
    });
  } catch (err) {
    console.error(err);
    return next(new ErrorHandler(error.message, 500));
  }
});


// admin
exports.getAllTickets = catchAsyncError(async (req, res, next) => {
  try {
    const tickets = await Ticket.find();
    res.status(200).json({
      success: true,
      tickets,
    });
  } catch (err) {
    console.error(err);
    return next(new ErrorHandler(error.message, 500));
  }
});
