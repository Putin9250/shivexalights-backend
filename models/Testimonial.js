import mongoose from "mongoose";

const TestimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: { type: String, default: "Verified Customer" },
    rating: { type: Number, default: 5 },
    comment: { type: String, required: true },
    avatar: String,
    isFeatured: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Testimonial", TestimonialSchema);
