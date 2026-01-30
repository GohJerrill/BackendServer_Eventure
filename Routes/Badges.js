import express from "express";
import { jwtVerify } from "jose";
import Badge from "../Models/BadgesModel.js";
import User from "../Models/UserModel.js";

const router = express.Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * GET /Badges
 * Returns unlocked + locked badges for logged-in user
 */
router.get("/", async (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Authentication required",
        });
    }

    const token = authHeader.split(" ")[1];

    // First: verify token
    let payload;
    try {
        ({ payload } = await jwtVerify(token, secret));
    } catch (err) {
        console.error("Invalid or expired token:", err);
        return res.status(401).json({
            message: "Invalid or expired token",
        });
    }

    const userId = payload.user_id;

    // normal logic in its own try/catch
    try {
        // 1) Get user
        const user = await User.findById(userId).lean();
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        //  ROLE GATE
        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
            });
        }

        // 2) Get all badges
        const allBadges = await Badge.find().lean();

        // 3) Extract earned badge references
        const earnedBadges = user.badges || [];

        // 4) Build unlocked list
        const unlocked = earnedBadges
            .map((ub) => {
                if (!ub || !ub.badge) return null;

                const fullBadge = allBadges.find(
                    (b) => b._id.toString() === ub.badge.toString()
                );

                if (!fullBadge) return null;

                return {
                    id: fullBadge._id.toString(),
                    name: fullBadge.name,
                    description: fullBadge.description,
                    icon_image: fullBadge.icon_image,
                    earned_date: ub.createdAt,
                };
            })
            .filter(Boolean);

        // 5) Build locked list
        const unlockedIds = unlocked.map((b) => b.id);

        const locked = allBadges
            .filter((b) => !unlockedIds.includes(b._id.toString()))
            .map((b) => ({
                id: b._id.toString(),
                name: b.name,
                description: b.description,
                icon_image: b.icon_image,
            }));

        return res.json({
            success: true,
            unlocked,
            locked,
        });
    } catch (err) {
        console.error("Error fetching badges:", err);
        return res.status(500).json({
            message: "Cannot fetch badges",
        });
    }
});


export default router;
