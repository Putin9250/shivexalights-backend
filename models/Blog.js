
import mongoose from "mongoose";

const BlogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    excerpt: String,
    content: { type: String, required: true },
    coverImg: String,
    author: {
      type: String,
      default: "Shivexa Lighting Editorial",
    },
    tags: [String],
    isPublished: { type: Boolean, default: true },

    seoTitle: { type: String, default: "" },
    seoDescription: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Blog", BlogSchema);
