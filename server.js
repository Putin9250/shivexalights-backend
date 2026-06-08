import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import NodeCache from "node-cache";
import Product from "./models/Product.js";
import Order from "./models/Order.js";
import Razorpay from "razorpay";
import Subscriber from "./models/Subscriber.js";

dotenv.config();

const cache = new NodeCache({ stdTTL: 60 }); // cache for 60 seconds

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
//subscriber
// ─────────────────────────────────────────────────────────────────────────
// Newsletter subscription
// ─────────────────────────────────────────────────────────────────────────

app.post("/api/subscribe", async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  try {
    // Check if already subscribed
    const existing = await Subscriber.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: "Email already subscribed" });
    }

    const subscriber = new Subscriber({ email });
    await subscriber.save();

    res.json({ message: "Subscribed successfully" });
  } catch (err) {
    console.error("Subscription error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// ─────────────────────────────────────────────────────────────────────────
// GET all products (optimised: pagination, caching, lean)
// ─────────────────────────────────────────────────────────────────────────
app.get("/api/products", async (req, res) => {
  try {
    const { featured, trending, category, limit = 12 } = req.query;

    // 1️⃣ Build filter
    let filter = {};
    if (featured === "true") filter.isFeatured = true;
    if (trending === "true") filter.isTrending = true;
    if (category) filter.categories = category;

    // 2️⃣ Enforce a reasonable maximum
    const maxLimit = Math.min(parseInt(limit), 24);

    // 3️⃣ Cache key from query string
    const cacheKey = JSON.stringify(req.query);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // 4️⃣ Fetch with .lean() for speed
    const products = await Product.find(filter)
      .limit(maxLimit)
      .lean();

    // 5️⃣ Store in cache
    cache.set(cacheKey, products);
    res.json(products);
  } catch (err) {
    res.status(500).json(err);
  }
});

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

// Delete all products (utility route)
app.get("/delete-all", async (req, res) => {
  try {
    await Product.deleteMany({});
    res.send("All products deleted");
  } catch (err) {
    res.status(500).json(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Orders & Payment routes
// ─────────────────────────────────────────────────────────────────────────

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
    const orders = await Order.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const order = new Order(req.body.data);
    const savedOrder = await order.save();
    res.json(savedOrder);
  } catch (err) {
    console.log("ORDER ERROR:", err);
    res.status(500).json({ error: "Order not saved" });
  }
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});