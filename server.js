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

const cache = new NodeCache({ stdTTL: 60 });

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const app = express();

app.use(cors());
app.use(express.json());

// ─── DB ───────────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("DB connected"))
  .catch((err) => console.log(err));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("API is running...");
});

// ─── Newsletter subscription ──────────────────────────────────────────────────
app.post("/api/subscribe", async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  try {
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

// ─── GET all products — paginated, cached, filtered ──────────────────────────
//
//  Query params:
//    featured  = "true"          → filter isFeatured
//    trending  = "true"          → filter isTrending
//    category  = "chandelier"    → filter by category string
//    limit     = 12              → results per page  (max 100)
//    page      = 1               → page number (1-based)
//
//  Response shape:
//    { products: [...], total, page, limit, totalPages, hasMore }
//
app.get("/api/products", async (req, res) => {
  try {
    const {
      featured,
      trending,
      category,
      limit  = 12,
      page   = 1,
    } = req.query;

    // Build filter
    const filter = {};
    if (featured === "true") filter.isFeatured = true;
    if (trending === "true") filter.isTrending = true;
    if (category)            filter.categories  = category;

    const parsedLimit = Math.min(Math.max(parseInt(limit) || 12, 1), 100);
    const parsedPage  = Math.max(parseInt(page)  || 1,  1);
    const skip        = (parsedPage - 1) * parsedLimit;

    // Cache key includes all query params
    const cacheKey = JSON.stringify(req.query);
    const cached   = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Parallel fetch: page of products + total count
    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(parsedLimit).lean(),
      Product.countDocuments(filter),
    ]);

    const result = {
      products,
      total,
      page:       parsedPage,
      limit:      parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
      hasMore:    parsedPage * parsedLimit < total,
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error("GET /api/products error:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ─── GET single product by ID ─────────────────────────────────────────────────
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(500).json(err);
  }
});

// ─── POST create product ──────────────────────────────────────────────────────
app.post("/api/products", async (req, res) => {
  try {
    const newProduct  = new Product(req.body);
    const savedProduct = await newProduct.save();
    res.json(savedProduct);
  } catch (err) {
    res.status(500).json(err);
  }
});

// ─── DELETE all products (utility) ───────────────────────────────────────────
app.get("/delete-all", async (req, res) => {
  try {
    await Product.deleteMany({});
    res.send("All products deleted");
  } catch (err) {
    res.status(500).json(err);
  }
});

// ─── Orders ───────────────────────────────────────────────────────────────────
app.post("/api/orders/create-razorpay-order", async (req, res) => {
  try {
    const options = {
      amount:   req.body.amount,
      currency: "INR",
      receipt:  "receipt_" + Date.now(),
    };
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error("Razorpay error:", err);
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
    const order      = new Order(req.body.data);
    const savedOrder = await order.save();
    res.json(savedOrder);
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ error: "Order not saved" });
  }
});




////// ______________________________________________________________________________________________________________
// Admin Panel ___________________---------------------------------------------------------

app.patch("/api/orders/:id", async (req, res) => {
  try {
    const updated = await Order.findByIdAndUpdate(req.params.id, { orderStatus: req.body.status }, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json(err); }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: "Order deleted" });
  } catch (err) { res.status(500).json(err); }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Product deleted" });
  } catch (err) { res.status(500).json(err); }
});
// GET all orders (admin only)
app.get("/api/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});
// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));