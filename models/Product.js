import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    price: Number,
    oldPrice: Number,

    img: String,
    img2: String,

    categories: [String], // ["Men", "Sale"]
    subCategories: [String], // ["Shirt", "Formal"]

    isNew: Boolean,
    isFeatured: Boolean,
    isTrending: Boolean,
  },
  { timestamps: true },
);

export default mongoose.model("Product", ProductSchema);
