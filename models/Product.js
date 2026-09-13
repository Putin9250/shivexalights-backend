// models/Product.js
import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    price: Number,
    oldPrice: Number,
    img: String,
    img2: String,
    img3: String, // new
    img4: String, // new
    categories: [String],
    subCategories: [String],
    isNew: Boolean,
    isFeatured: Boolean,
    isTrending: Boolean,
    stock: { type: Number, default: 0 },
    recommendedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    sizes: [
      // new – optional array of objects
      {
        name: { type: String, required: true }, // e.g. "Small", "Medium"
        price: { type: Number, required: true },
        stock: { type: Number, min: 0 }, // optional per-size inventory
      },
    ],
  },
  { timestamps: true },
);

ProductSchema.index({ categories: 1, updatedAt: -1 });
ProductSchema.index({ isFeatured: 1, updatedAt: -1 });
ProductSchema.index({ isTrending: 1, updatedAt: -1 });

export default mongoose.model("Product", ProductSchema);
