const express = require("express");
const {
  getUsers,
  addUser,
  payForTicket,
} = require("../controllers/User.controller.js");

const userRouter = express.Router();

userRouter.get("/get-users", getUsers);
userRouter.post("/add-user", addUser);
userRouter.post("/booking-pay", payForTicket);

module.exports = userRouter;
