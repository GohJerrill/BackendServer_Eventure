import express from "express";
import { jwtVerify } from "jose";
import Reward from "../Models/RewardsModel.js";


import ClaimedReward from "../Models/ClaimedRewardModel.js";
import User from "../Models/UserModel.js";

import mongoose from "mongoose";

const router = express.Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * GET /ClaimedRewards
 * JWT required
 * Returns claimed reward history for logged-in student
 */
router.get("/", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        // 1) Check auth header first
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Authentication required",
            });
        }

        const token = authHeader.split(" ")[1];

        // 2) Verify JWT in its own try/catch
        let payload;
        try {
            ({ payload } = await jwtVerify(token, secret));
        } catch (err) {
            console.error("Invalid or expired token (ClaimedRewards):", err);
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload?.user_id;

        if (!userId || typeof userId !== "string") {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing or invalid user id",
            });
        }

        // Optional but nice: validate ObjectId shape
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                code: "BAD_USER_ID",
                message: "Invalid user id in token",
            });
        }

        // 3) Main logic
        //    Check user exists + is Student
        const user = await User.findById(userId).select("role student_email").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        const role = String(user.role || "").toUpperCase();
        if (role !== "STUDENT") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
            });
        }

        // 4) Get claimed rewards for this user
        const claims = await ClaimedReward.find({ user: userId })
            .populate({
                path: "reward",
                select: "name reward_image cost", 
            })
            .sort({ createdAt: -1 })
            .lean();

        // 5) Shape data for frontend
        const processed = claims.map((c) => ({
            id: c._id.toString(),
            reward_name: c.reward?.name || "Unknown Reward",
            reward_image: c.reward?.reward_image || "",
            reward_cost: c.reward?.cost || 0,
            user_email: user.student_email || "N/A",
            claimed_at: c.createdAt,
        }));

        return res.json({
            success: true,
            code: "CLAIMS_OK",
            data: processed,
        });
    } catch (err) {
        console.error("Error fetching claimed rewards:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Cannot fetch claimed rewards",
        });
    }
});

export default router;
