// server.js
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();


// Route files //
import userRoutes from "./Routes/Users.js";
import eventRoutes from "./Routes/Events.js";
import bookmarkRoutes from "./Routes/Bookmarks.js";
import registeredEventRoutes from "./Routes/RegisteredEvents.js";
import rewardRoutes from "./Routes/Rewards.js";
import badgeRoutes from "./Routes/Badges.js";
import notificationRoutes from "./Routes/Notifications.js";
import ClaimedRewardRoutes from "./Routes/ClaimedReward.js";
import ProfileRoutes from "./Routes/ProfileRoutes.js";
import AdminRoutes from "./Routes/AdminRoute.js"


// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));


// ===== Health check route =====
app.get("/", (req, res) => {
    res.send("TP Eventure API is running");
});

// ===== MongoDB connection =====
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
}

mongoose
    .connect(MONGO_URI)
    .then(() => {
        console.log("Connected to MongoDB");
    })
    .catch((err) => {
        console.error("MongoDB connection error:", err.message);
        process.exit(1);
    });

// ===== API routes =====
app.use("/User", userRoutes);
app.use("/Events", eventRoutes);
app.use("/Bookmarks", bookmarkRoutes);
app.use("/Registrations", registeredEventRoutes);
app.use("/Rewards", rewardRoutes);
app.use("/Badges", badgeRoutes);
app.use("/Notifications", notificationRoutes);
app.use("/ClaimedRewards", ClaimedRewardRoutes);
app.use("/Profile", ProfileRoutes)
app.use("/Admin", AdminRoutes)


// ===== Start server =====
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
