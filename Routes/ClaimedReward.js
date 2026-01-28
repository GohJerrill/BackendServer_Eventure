import express from "express";
import { jwtVerify } from "jose";
import ClaimedReward from "../Models/ClaimedRewardModel.js";
import Reward from "../Models/RewardsModel.js";
import User from "../Models/UserModel.js";

const router = express.Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * GET /ClaimedRewards
 * JWT required
 * Returns claimed reward history for logged-in user
 */
router.get("/", async (req, res) => {
    const authHeader = req.headers.authorization;

    // 1) Check auth header first
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
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
            message: "Invalid or expired token",
        });
    }

    const userId = payload.user_id;

    // 3) Main logic in a separate try/catch
    try {
        // (Optional) Check user exists
        const user = await User.findById(userId).lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        //  ROLE GATE
        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
            });
        }

        // 1) Get claimed rewards for this user
        const claims = await ClaimedReward.find({ user: userId })
            .populate("reward")
            .populate("user")
            .sort({ createdAt: -1 })
            .lean();

        // 2) Shape data for frontend
        const processed = claims.map((c) => ({
            id: c._id.toString(),
            reward_name: c.reward?.name || "Unknown Reward",
            reward_image: c.reward?.reward_image || "",
            reward_cost: c.reward?.cost || 0,
            user_email: c.user?.student_email || "N/A",
            claimed_at: c.createdAt,
        }));

        return res.json({
            success: true,
            data: processed,
        });

    } catch (err) {
        console.error("Error fetching claimed rewards:", err);
        return res.status(500).json({
            success: false,
            message: "Cannot fetch claimed rewards",
        });
    }
});

export default router;
