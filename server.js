import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import NodeCache from "node-cache";
import Product from "./models/Product.js";
import Order from "./models/Order.js";
import Razorpay from "razorpay";
import Subscriber from "./models/Subscriber.js";
import Blog from "./models/Blog.js";
import Testimonial from "./models/Testimonial.js";

dotenv.config();

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://shivexalights.in",
  "https://www.shivexalights.in",
  process.env.CLIENT_ORIGIN,
].filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json());

const xmlEscape = (value) => String(value || "").replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[character]));
const publicSiteUrl = (req) => (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

app.get("/robots.txt", (req, res) => {
  const siteUrl = publicSiteUrl(req);
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${siteUrl}/sitemap.xml\n`);
});

app.get("/sitemap.xml", async (req, res) => {
  try {
    const siteUrl = publicSiteUrl(req);
    const [products, blogs] = await Promise.all([
      Product.find({}, "_id updatedAt").lean(),
      Blog.find({ isPublished: true }, "_id updatedAt").lean(),
    ]);
    const staticRoutes = ["/", "/products", "/about", "/contact", "/blogs"];
    const urls = [
      ...staticRoutes.map((path) => ({ loc: `${siteUrl}/#${path}` })),
      ...products.map((product) => ({ loc: `${siteUrl}/#/product/${product._id}`, lastmod: product.updatedAt })),
      ...blogs.map((blog) => ({ loc: `${siteUrl}/#/blog/${blog._id}`, lastmod: blog.updatedAt })),
    ];
    const body = urls.map(({ loc, lastmod }) => `<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`).join("");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
  } catch (error) {
    res.status(500).type("application/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><error>Unable to build sitemap</error>");
  }
});

// ─── DB ───────────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("DB connected"))
  .catch((err) => console.log(err));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("API is running...");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), time: new Date() });
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

app.get("/api/subscribers", async (req, res) => {
  try {
    const subscribers = await Subscriber.find().sort({ subscribedAt: -1 });
    res.json(subscribers);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch subscribers" });
  }
});

app.delete("/api/subscribers/:id", async (req, res) => {
  try {
    await Subscriber.findByIdAndDelete(req.params.id);
    res.json({ message: "Subscriber removed" });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove subscriber" });
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
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
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
    const product = await Product.findById(req.params.id).populate("recommendedProducts");
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

app.put("/api/products/:id", async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!updatedProduct) return res.status(404).json({ message: "Product not found" });
    cache.flushAll();
    res.json(updatedProduct);
  } catch (err) {
    res.status(500).json({ error: "Failed to update product" });
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
app.post("/api/orders/validate", async (req, res) => {
  try {
    const lineItems = req.body.products;
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ error: "Your cart is empty" });
    }
    for (const lineItem of lineItems) {
      const product = await Product.findById(lineItem.documentId || lineItem.id);
      if (!product) throw new Error(`${lineItem.title || "Product"} is no longer available`);
      const selectedSize = lineItem.size ? product.sizes.find((size) => size.name === lineItem.size) : null;
      if (lineItem.size && !selectedSize) throw new Error(`The selected size for ${product.title} is unavailable`);
      const usesVariantStock = selectedSize && Number.isFinite(Number(selectedSize.stock));
      const availableStock = usesVariantStock ? Number(selectedSize.stock) : Number(product.stock ?? 0);
      if (availableStock < Math.max(Number(lineItem.quantity) || 1, 1)) {
        throw new Error(`Only ${availableStock} item(s) of ${product.title} are available`);
      }
    }
    res.json({ valid: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Unable to validate cart" });
  }
});

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
  const stockUpdates = [];
  try {
    const orderData = req.body.data;
    if (!orderData?.products?.length) {
      return res.status(400).json({ error: "Your cart is empty" });
    }

    // Validate inventory before creating an order. Products with variant stock use
    // the chosen size's inventory; older products fall back to their overall stock.
    for (const lineItem of orderData.products) {
      const productId = lineItem.documentId || lineItem.id;
      const quantity = Math.max(Number(lineItem.quantity) || 1, 1);
      const product = await Product.findById(productId);
      if (!product) throw new Error(`${lineItem.title || "Product"} is no longer available`);

      const selectedSize = lineItem.size
        ? product.sizes.find((size) => size.name === lineItem.size)
        : null;
      if (lineItem.size && !selectedSize) throw new Error(`The selected size for ${product.title} is unavailable`);

      const usesVariantStock = selectedSize && Number.isFinite(Number(selectedSize.stock));
      const availableStock = usesVariantStock ? Number(selectedSize.stock) : Number(product.stock ?? 0);
      if (availableStock < quantity) throw new Error(`Only ${availableStock} item(s) of ${product.title} are available`);

      stockUpdates.push({ product, selectedSize, usesVariantStock, quantity, applied: false });
    }

    for (const update of stockUpdates) {
      if (update.usesVariantStock) update.selectedSize.stock -= update.quantity;
      else update.product.stock -= update.quantity;
      await update.product.save();
      update.applied = true;
    }

    const order      = new Order(orderData);
    const savedOrder = await order.save();
    cache.flushAll();
    res.json(savedOrder);
  } catch (err) {
    // Restore inventory if saving the order failed after stock was reserved.
    await Promise.all(stockUpdates.filter((update) => update.applied).map(async (update) => {
      if (update.usesVariantStock) update.selectedSize.stock += update.quantity;
      else update.product.stock += update.quantity;
      await update.product.save();
    }));
    console.error("Order error:", err);
    res.status(400).json({ error: err.message || "Order not saved" });
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

// ─── BLOGS API ─────────────────────────────────────────────────────────────────
app.get("/api/blogs", async (req, res) => {
  try {
    const blogs = await Blog.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(blogs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch blogs" });
  }
});

app.get("/api/blogs/:id", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: "Blog not found" });
    res.json(blog);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.post("/api/blogs", async (req, res) => {
  try {
    const newBlog = new Blog(req.body);
    const savedBlog = await newBlog.save();
    res.json(savedBlog);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.put("/api/blogs/:id", async (req, res) => {
  try {
    const updatedBlog = await Blog.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedBlog);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.delete("/api/blogs/:id", async (req, res) => {
  try {
    await Blog.findByIdAndDelete(req.params.id);
    res.json({ message: "Blog deleted" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ─── TESTIMONIALS API ──────────────────────────────────────────────────────────
app.get("/api/testimonials", async (req, res) => {
  try {
    const testimonials = await Testimonial.find().sort({ createdAt: -1 });
    res.json(testimonials);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

app.post("/api/testimonials", async (req, res) => {
  try {
    const newTestimonial = new Testimonial(req.body);
    const savedTestimonial = await newTestimonial.save();
    res.json(savedTestimonial);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.delete("/api/testimonials/:id", async (req, res) => {
  try {
    await Testimonial.findByIdAndDelete(req.params.id);
    res.json({ message: "Testimonial deleted" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
