// routes/rewards.js
import express from "express";
import Reward from "../Models/RewardsModel.js";

import User from "../Models/UserModel.js";
import ClaimedReward from "../Models/ClaimedRewardModel.js";
import Notification from "../Models/NotificationModel.js";
import Badge from "../Models/BadgesModel.js";

import { jwtVerify } from "jose";

import mongoose from "mongoose";


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
        return res.json(rewards); // keep existing shape so frontend doesn't break
    } catch (err) {
        console.error("Error fetching rewards:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Cannot fetch rewards",
        });
    }
});

/**
 * POST /Rewards/Redeem
 * body: { rewardId }
 * auth: Bearer token (required, Students only)
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
            console.warn("Invalid JWT in /Rewards/Redeem:", e.message);
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload.user_id; // from your JWT
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid token user id",
            });
        }

        // ===== BODY VALIDATION =====
        const { rewardId } = req.body || {};
        if (!rewardId) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "rewardId is required",
            });
        }

        if (!mongoose.Types.ObjectId.isValid(rewardId)) {
            return res.status(400).json({
                success: false,
                code: "INVALID_REWARD_ID",
                message: "Invalid reward id",
            });
        }

        // ===== LOAD USER (with role + points + badges) =====
        const user = await User.findById(userId)
            .select("role points badges")
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        const roleStr = String(user.role || "").toUpperCase();
        if (roleStr !== "STUDENT") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Only students can redeem rewards",
            });
        }

        // ===== LOAD REWARD =====
        const reward = await Reward.findById(rewardId).lean();
        if (!reward) {
            return res.status(404).json({
                success: false,
                code: "REWARD_NOT_FOUND",
                message: "Reward not found",
            });
        }

        const rewardCost = Number(reward.cost ?? 0);
        const rewardStock = Number(reward.stock ?? 0);
        const userPoints = Number(user.points ?? 0);

        if (!Number.isFinite(rewardCost) || rewardCost <= 0) {
            return res.status(400).json({
                success: false,
                code: "BAD_REWARD_CONFIG",
                message: "Reward cost is invalid",
            });
        }

        if (rewardStock <= 0) {
            return res.status(409).json({
                success: false,
                code: "OUT_OF_STOCK",
                message: "Reward is out of stock",
            });
        }

        if (!Number.isFinite(userPoints) || userPoints < rewardCost) {
            return res.status(409).json({
                success: false,
                code: "INSUFFICIENT_POINTS",
                message: "Not enough points",
            });
        }

        // ===== ATOMIC UPDATES =====

        // 1) Decrement stock atomically (only if stock > 0)
        const updatedReward = await Reward.findOneAndUpdate(
            { _id: rewardId, stock: { $gt: 0 } },
            { $inc: { stock: -1 } },
            { new: true }
        ).lean();

        if (!updatedReward) {
            // Someone else grabbed the last one
            return res.status(409).json({
                success: false,
                code: "OUT_OF_STOCK",
                message: "Reward is out of stock",
            });
        }

        // 2) Deduct points atomically (only if user has enough)
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, points: { $gte: rewardCost } },
            { $inc: { points: -rewardCost } },
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

        // 3) Create claim record
        await ClaimedReward.create({
            user: userId,
            reward: rewardId,
        });

        // ===== BADGE + NOTIFICATION CHECKS =====
        const claimCount = await ClaimedReward.countDocuments({ user: userId });

        const BADGE_FIELD = "badgeId";

        const [rewardMerchantBadge, finalBadge, allBadges] = await Promise.all([
            Badge.findOne({ [BADGE_FIELD]: "B11" }).lean(),
            Badge.findOne({ [BADGE_FIELD]: "B12" }).lean(),
            Badge.find({}).select("_id " + BADGE_FIELD).lean(),
        ]);

        let finalUser = updatedUser;

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
        if (finalBadge) {
            const alreadyHasFinal = hasBadgeObjectId(finalUser, finalBadge._id);

            if (!alreadyHasFinal) {
                const requiredBadgeObjectIds = allBadges
                    .filter((b) => String(b._id) !== String(finalBadge._id))
                    .map((b) => String(b._id));

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

        // ===== RESPONSE (safe user) =====
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
