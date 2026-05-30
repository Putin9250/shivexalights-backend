import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";
import Order from "./models/Order.js";
import Razorpay from "razorpay";

dotenv.config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// 🔥 CONNECT DATABASE
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("DB connected"))
  .catch((err) => console.log(err));

// test route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// products route (temporary)
// Get a single product by ID
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(500).json(err);
  }
});
// GET all products
app.get("/api/products", async (req, res) => {
  try {
    const { featured, trending, category } = req.query;

    let filter = {};

    if (featured === "true") filter.isFeatured = true;
    if (trending === "true") filter.isTrending = true;
    if (category) filter.categories = category;

    const products = await Product.find(filter);

    res.json(products);
  } catch (err) {
    res.status(500).json(err);
  }
});
const PORT = 5000;
app.get("/delete-all", async (req, res) => {
  try {
    await Product.deleteMany({});
    res.send("All products deleted");
  } catch (err) {
    res.status(500).json(err);
  }
});

app.post("/api/orders/create-razorpay-order", async (req, res) => {
  try {
    const options = {
      amount: req.body.amount,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };

    const order = await razorpay.orders.create(options);

    res.json(order);
  } catch (err) {
    console.log("RAZORPAY ERROR:", err);
    res.status(500).json({ error: "Razorpay failed" });
  }
});

app.get("/api/orders/user/:userId", async (req, res) => {
  try {
    const orders = await Order.find({
      userId: req.params.userId,
    }).sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.post("/api/products", async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    const savedProduct = await newProduct.save();
    res.json(savedProduct);
  } catch (err) {
    res.status(500).json(err);
  }
});


app.post("/api/orders", async (req, res) => {
  try {
    const order = new Order(req.body.data); // IMPORTANT: .data
    const savedOrder = await order.save();

    res.json(savedOrder);
  } catch (err) {
    console.log("ORDER ERROR:", err);
    res.status(500).json({ error: "Order not saved" });
  }
});

