// scripts/seedTestData.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../models/Product.js";

dotenv.config();

const CLOUDINARY_IMAGES = [
  "https://res.cloudinary.com/dltlvocih/image/upload/v1780658936/Screenshot_2026-06-05_165425_nlbfby.png",
  "https://res.cloudinary.com/dltlvocih/image/upload/v1780660626/Screenshot_2026-06-05_172658_ea79dv.png",
  "https://res.cloudinary.com/dltlvocih/image/upload/v1780660402/Screenshot_2026-06-05_172237_jb0bay.png",
  "https://res.cloudinary.com/dltlvocih/image/upload/v1780648075/Screenshot_2026-06-05_135735_lljkyq.png",
];

const categories = ["Duplex Hanging Light", "LED Mirror Lights"];
const adjectives = ["Aurora", "Lumina", "Eclipse", "Nova", "Stellar", "Orbit", "Celestia", "Velvet", "Roma", "Venezia", "Helix", "Lustre"];
const descriptors = ["Duplex", "Twin", "Double", "Ring", "Globe", "Lantern", "Pendant", "Chandelier"];

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const generateProducts = (count) => {
  const products = [];
  for (let i = 0; i < count; i++) {
    const category = categories[i % 2];
    const title = `${adjectives[i % adjectives.length]} ${descriptors[i % descriptors.length]} ${Math.floor(i / categories.length) + 1}`;
    const price = randomInt(5000, 50000);
    const oldPrice = price + randomInt(2000, 15000);
    products.push({
      title,
      description: `Premium ${category.toLowerCase().replace(" lights", "")} – elegant design, high efficiency.`,
      price,
      oldPrice,
      img: CLOUDINARY_IMAGES[0],
      img2: CLOUDINARY_IMAGES[1],
      img3: CLOUDINARY_IMAGES[2],
      img4: CLOUDINARY_IMAGES[3],
      categories: [category],
      isNew: Math.random() > 0.7,
      isFeatured: Math.random() > 0.8,
      isTrending: Math.random() > 0.7,
      sizes: Math.random() > 0.5 ? [{ name: "Standard", price }] : [],
    });
  }
  return products;
};

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    await Product.deleteMany({ categories: { $in: categories } }); // clear old test data
    const products = generateProducts(100);
    await Product.insertMany(products);
    console.log(`✅ Inserted ${products.length} test products.`);
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

seed();