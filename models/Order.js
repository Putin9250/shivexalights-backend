import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    phoneNumber: String,
    address: String,
    pin: String,

    products: Array,

    totalAmount: Number,

    paymentId: String,
    orderStatus: String,

    userId: String,
    userEmail: String,
  },
  { timestamps: true }
);

export default mongoose.model("Order", OrderSchema);