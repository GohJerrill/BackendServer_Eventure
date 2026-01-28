// routes/rewards.js
import express from "express";
import Reward from "../Models/RewardsModel.js";

import User from "../Models/UserModel.js";
import ClaimedReward from "../Models/ClaimedRewardModel.js";
import Notification from "../Models/NotificationModel.js";
import Badge from "../Models/BadgesModel.js";

import { jwtVerify } from "jose";


const router = express.Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);


/**
 * GET /Rewards
 * Public route
 * Returns all rewards
 */
router.get("/", async (req, res) => {
    try {
        const rewards = await Reward.find().sort({ cost: 1 }).lean();

        return res.json(rewards);
    } catch (err) {
        console.error("Error fetching rewards:", err);
        return res.status(500).json({
            message: "Cannot fetch rewards",
        });
    }
});

/**
 * POST /Rewards/Redeem
 * body: { rewardId }
 * auth: Bearer token (required)
 */
router.post("/Redeem", async (req, res) => {
    try {
        // ===== JWT CHECK =====
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Authentication required",
            });
        }

        const token = authHeader.split(" ")[1];

        let payload;
        try {
            const verified = await jwtVerify(token, secret);
            payload = verified.payload;
        } catch (e) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid token",
            });
        }

        const userId = payload.user_id; // <-- your JWT field
        if (!userId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // ===== BODY VALIDATION =====
        const { rewardId } = req.body;
        if (!rewardId) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "rewardId is required",
            });
        }

        // ===== LOAD USER + REWARD (cheap checks) =====
        const [user, reward] = await Promise.all([
            User.findById(userId).lean(),
            Reward.findById(rewardId).lean(),
        ]);

        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        if (!reward) {
            return res.status(404).json({
                success: false,
                code: "REWARD_NOT_FOUND",
                message: "Reward not found",
            });
        }

        const userPoints = user.points ?? 0;

        if (reward.stock <= 0) {
            return res.status(409).json({
                success: false,
                code: "OUT_OF_STOCK",
                message: "Reward is out of stock",
            });
        }

        if (userPoints < reward.cost) {
            return res.status(409).json({
                success: false,
                code: "INSUFFICIENT_POINTS",
                message: "Not enough points",
            });
        }

        // ===== ATOMIC UPDATES =====
        // 1) Decrement stock atomically
        const updatedReward = await Reward.findOneAndUpdate(
            { _id: rewardId, stock: { $gt: 0 } },
            { $inc: { stock: -1 } },
            { new: true }
        ).lean();

        if (!updatedReward) {
            return res.status(409).json({
                success: false,
                code: "OUT_OF_STOCK",
                message: "Reward is out of stock",
            });
        }

        // 2) Deduct points atomically
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, points: { $gte: reward.cost } },
            { $inc: { points: -reward.cost } },
            { new: true }
        ).lean();

        // rollback stock if points failed after stock success
        if (!updatedUser) {
            await Reward.findByIdAndUpdate(rewardId, { $inc: { stock: 1 } });
            return res.status(409).json({
                success: false,
                code: "INSUFFICIENT_POINTS",
                message: "Not enough points",
            });
        }

        // 3) Create claim record (MATCH YOUR SCHEMA)
        await ClaimedReward.create({
            user: userId,
            reward: rewardId,
        });

        // ===== BADGE + NOTIFICATION CHECK (B11 at 10 claims) =====
        // ===== BADGE + NOTIFICATION CHECKS =====
        const claimCount = await ClaimedReward.countDocuments({ user: userId });

        // Use your business badge id field 
        const BADGE_FIELD = "badgeId";

        const [rewardMerchantBadge, finalBadge, allBadges] = await Promise.all([
            Badge.findOne({ [BADGE_FIELD]: "B11" }).lean(),
            Badge.findOne({ [BADGE_FIELD]: "B12" }).lean(),
            Badge.find({}).select("_id " + BADGE_FIELD).lean(),
        ]);

        let finalUser = updatedUser;

        // Helper: quickly check if user already has a badge ObjectId
        const hasBadgeObjectId = (u, badgeObjectId) =>
            (u.badges || []).some((b) => String(b.badge) === String(badgeObjectId));

        /* ========= B11: Reward Merchants (10 claims) ========= */
        if (rewardMerchantBadge && claimCount >= 10) {
            if (!hasBadgeObjectId(finalUser, rewardMerchantBadge._id)) {
                const earnedAt = new Date();

                const badgeUser = await User.findOneAndUpdate(
                    { _id: userId, "badges.badge": { $ne: rewardMerchantBadge._id } },
                    { $push: { badges: { badge: rewardMerchantBadge._id, earned_date: earnedAt } } },
                    { new: true }
                ).lean();

                if (badgeUser) {
                    finalUser = badgeUser;

                    await Notification.create({
                        user: userId,
                        type: "Badge",
                        message: 'You earned the "Reward Merchants" badge!',
                        is_read: false,
                        icon: "/notifications/badges.png",
                    });
                }
            }
        }

        /* ========= B12: TP Eventure (all previous badges) ========= */
        // Only run if final badge exists
        if (finalBadge) {
            const alreadyHasFinal = hasBadgeObjectId(finalUser, finalBadge._id);

            if (!alreadyHasFinal) {
                // Build set of required badge ObjectIds (ALL badges except B12)
                const requiredBadgeObjectIds = allBadges
                    .filter((b) => String(b._id) !== String(finalBadge._id))
                    .map((b) => String(b._id));

                // Build set of user's badge ObjectIds
                const userBadgeObjectIds = new Set(
                    (finalUser.badges || []).map((b) => String(b.badge))
                );

                const hasAllRequired = requiredBadgeObjectIds.every((id) =>
                    userBadgeObjectIds.has(id)
                );

                if (hasAllRequired) {
                    const earnedAt = new Date();

                    const finalUserUpdated = await User.findOneAndUpdate(
                        { _id: userId, "badges.badge": { $ne: finalBadge._id } },
                        { $push: { badges: { badge: finalBadge._id, earned_date: earnedAt } } },
                        { new: true }
                    ).lean();

                    if (finalUserUpdated) {
                        finalUser = finalUserUpdated;

                        await Notification.create({
                            user: userId,
                            type: "Badge",
                            message: 'You earned the "TP Eventure" badge!',
                            is_read: false,
                            icon: "/notifications/badges.png",
                        });
                    }
                }
            }
        }


        // Return safe user
        const { password, __v, ...safeUser } = finalUser;

        return res.json({
            success: true,
            code: "REDEEM_OK",
            message: "Reward redeemed successfully",
            user: { id: safeUser._id.toString(), ...safeUser },
            reward: { id: updatedReward._id.toString(), ...updatedReward },
        });
    } catch (err) {
        console.error("Redeem error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});

export default router;
