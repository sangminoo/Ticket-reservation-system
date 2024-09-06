const express = require("express");
const {
  getAllTickets,
  createTicket,getAllTicketsAvailable
} = require("../controllers/Ticket.controller.js");

const ticketRouter = express.Router();

ticketRouter.get("/get-tickets", getAllTickets);
ticketRouter.get("/get-tickets-available", getAllTicketsAvailable);
// only admin update later
ticketRouter.post("/create-ticket", createTicket);

module.exports = ticketRouter;
