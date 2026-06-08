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
    img3: String,          // new
    img4: String,          // new
    categories: [String],
    subCategories: [String],
    isNew: Boolean,
    isFeatured: Boolean,
    isTrending: Boolean,
    sizes: [               // new – optional array of objects
      {
        name: { type: String, required: true },   // e.g. "Small", "Medium"
        price: { type: Number, required: true },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Product", ProductSchema);