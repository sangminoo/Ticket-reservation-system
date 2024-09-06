require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./src/db");
const cookieParser = require("cookie-parser");
const errorMiddleware = require("./src/middleware/error");
const ticketRouter = require("./src/routes/Ticket.route");
const bookingRouter = require("./src/routes/Booking.route");
const userRouter = require("./src/routes/User.route");

const PORT = process.env.PORT || 8000;
const app = express();

// for testing
app.get("/", (req, res) => {
  res.send("Api is working");
});

// middleware
app.use(express.json());
app.use(cors());
app.use(cookieParser());

// routes
app.use("/api/v1", ticketRouter, userRouter, bookingRouter);

app.use(errorMiddleware, () => {});

app.listen(PORT, () => {
  // Connect Database
  connectDB();
  console.log(`Server started on port ${PORT}`);
});
