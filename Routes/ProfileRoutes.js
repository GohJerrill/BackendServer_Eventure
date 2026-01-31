import express from "express";
import { jwtVerify } from "jose";
import User from "../Models/UserModel.js";
import Event from "../Models/EventsModel.js";
import Badge from "../Models/BadgesModel.js";
import RegisteredEvent from "../Models/RegisteredEventModel.js";
import Notification from "../Models/NotificationModel.js";

const router = express.Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);


router.get("/", async (req, res) => {
    try {
        // ===== JWT CHECK (INLINE) =====
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED" });
        }

        const token = authHeader.split(" ")[1];

        let payload;
        try {
            ({ payload } = await jwtVerify(token, secret));
        } catch {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED" });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED" });
        }

        const user = await User.findById(userId).lean();
        if (!user) {
            return res.status(404).json({ success: false, code: "USER_NOT_FOUND" });
        }

        // STUDENT ONLY
        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
                role: user.role, // optional but helpful
            });
        }

        // ===== registered events =====
        const registrations = await RegisteredEvent.find({ user_id: user._id })
            .sort({ createdAt: -1 })
            .populate("event_id", "title image organiser start_date end_date location status points type max_capacity")
            .lean();

        const formattedRegs = registrations.map((r) => ({
            id: r._id.toString(),
            event_id: r.event_id?._id?.toString() ?? null,
            event: r.event_id
                ? {
                    id: r.event_id._id.toString(),
                    title: r.event_id.title,
                    image: r.event_id.image,
                    organiser: r.event_id.organiser,
                    start_date: r.event_id.start_date,
                    end_date: r.event_id.end_date,
                    location: r.event_id.location,
                    status: r.event_id.status,
                    points: r.event_id.points,
                    type: r.event_id.type,
                    max_capacity: r.event_id.max_capacity,
                }
                : null,
            turn_up: r.turn_up ?? false,
            scanned_at: r.scanned_at ?? null,
            date_registered: r.createdAt,
        }));

        const { password, __v, ...safeUser } = user;

        return res.json({
            success: true,
            role: user.role, // "Student"
            user: { id: user._id.toString(), ...safeUser },
            registeredEvents: formattedRegs,
        });
    } catch (err) {
        console.error("Profile fetch error:", err);
        return res.status(500).json({ success: false, code: "SERVER_ERROR" });
    }
});


router.put("/", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" });
        }

        const token = authHeader.split(" ")[1];

        let payload;
        try {
            const verified = await jwtVerify(token, secret);
            payload = verified.payload;
        } catch {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Invalid token" });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Token missing user id" });
        }

        // after you load user
        const user = await User.findById(userId).select("role").lean();
        if (!user) return res.status(404).json({ success: false, code: "USER_NOT_FOUND" });

        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
            });
        }


        // ===== BODY =====
        let { username, profile_image } = req.body;

        // Treat null/empty as "not provided"
        if (username === null || username === "") username = undefined;
        if (profile_image === null || profile_image === "") profile_image = undefined;

        if (username === undefined && profile_image === undefined) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "No fields provided to update",
            });
        }

        // ===== VALIDATION =====
        if (username !== undefined) {
            if (typeof username !== "string") {
                return res.status(400).json({ success: false, code: "BAD_REQUEST", message: "username must be a string" });
            }
            const trimmed = username.trim();
            if (trimmed.length < 2) {
                return res.status(400).json({ success: false, code: "USERNAME_TOO_SHORT", message: "Username must be at least 2 characters" });
            }
            if (trimmed.length > 20) {
                return res.status(400).json({ success: false, code: "USERNAME_TOO_LONG", message: "Username max is 20 characters" });
            }
            username = trimmed;
        }

        if (profile_image !== undefined) {
            if (typeof profile_image !== "string") {
                return res.status(400).json({ success: false, code: "BAD_REQUEST", message: "profile_image must be a string" });
            }

            const img = profile_image.trim();
            const ok = img.startsWith("/") || img.startsWith("data:image/");
            if (!ok) {
                return res.status(400).json({ success: false, code: "BAD_REQUEST", message: "Invalid profile_image format" });
            }

            profile_image = img;
        }

        // ===== UPDATE =====
        const update = {};
        if (username !== undefined) update.username = username;
        if (profile_image !== undefined) update.profile_image = profile_image;

        const updatedUser = await User.findByIdAndUpdate(userId, { $set: update }, { new: true }).lean();

        if (!updatedUser) {
            return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "User not found" });
        }

        const { password, __v, ...safeUser } = updatedUser;

        return res.json({
            success: true,
            code: "PROFILE_UPDATED",
            user: { id: safeUser._id.toString(), ...safeUser },
        });
    } catch (err) {
        console.error("Update profile error:", err);
        return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to update profile" });
    }
});


router.get("/Rank", async (req, res) => {
    try {
        // ===== JWT CHECK (INLINE) =====
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" });
        }

        const token = authHeader.split(" ")[1];

        let payload;
        try {
            ({ payload } = await jwtVerify(token, secret));
        } catch {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Invalid or expired token" });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Token missing user id" });
        }

        // ===== LOAD USER + ROLE GATE =====
        const me = await User.findById(userId).select("_id role").lean();
        if (!me) {
            return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "User not found" });
        }

        if (me.role !== "Student") {
            return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Students only", role: me.role });
        }

        // ===== RANK LOGIC =====
        const students = await User.find({ role: "Student", createdAt: { $exists: true } })
            .select("_id total_points username")
            .lean();

        const totalUsers = students.length;

        const allZeroPoints =
            totalUsers > 0 && students.every((u) => (u.total_points ?? 0) === 0);

        // If all 0, rank should be "-"
        if (allZeroPoints) {
            return res.json({
                success: true,
                code: "RANK_OK",
                rank: "-",
                totalUsers,
                allZeroPoints: true,
            });
        }

        // Otherwise rank normally (stable sort)
        students.sort((a, b) => {
            const diff = (b.total_points ?? 0) - (a.total_points ?? 0);
            if (diff !== 0) return diff;
            return String(a.username || "").localeCompare(String(b.username || ""));
        });

        const rank = students.findIndex((u) => String(u._id) === String(me._id)) + 1;

        return res.json({
            success: true,
            code: "RANK_OK",
            rank,
            totalUsers,
            allZeroPoints: false,
        });
    } catch (err) {
        console.error("Rank fetch error:", err);
        return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to fetch rank" });
    }
});



router.get("/Badges", async (req, res) => {
    try {
        // ===== JWT CHECK (INLINE) =====
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
            ({ payload } = await jwtVerify(token, secret));
        } catch {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // ===== LOAD USER + ROLE GATE =====
        const user = await User.findById(userId).select("role badges").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
                role: user.role,
            });
        }

        if (!Array.isArray(user.badges) || user.badges.length === 0) {
            // keep your existing frontend expectation: just return []
            return res.json([]);
        }

        const allBadges = await Badge.find().lean();

        const earned = user.badges
            .map((b) => {
                const badge = allBadges.find(
                    (ab) => String(ab._id) === String(b.badge)
                );
                if (!badge) return null;

                return {
                    id: badge._id.toString(),
                    name: badge.name,
                    description: badge.description,
                    icon_image: badge.icon_image,
                    earned_date: b.createdAt || b.earned_date || null,
                };
            })
            .filter(Boolean)
            .sort((a, b) => new Date(b.earned_date) - new Date(a.earned_date));

        return res.json(earned);
    } catch (err) {
        console.error("Badge fetch error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to fetch badges",
        });
    }
});

router.get("/PastEvents", async (req, res) => {
    try {
        // ===== JWT CHECK (INLINE) =====
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
            ({ payload } = await jwtVerify(token, secret));
        } catch {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // ===== LOAD USER + ROLE GATE =====
        const user = await User.findById(userId).select("_id role").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
                role: user.role,
            });
        }

        // 1) attended registrations
        const regs = await RegisteredEvent.find({
            user_id: user._id,
            turn_up: true,
        })
            .select("event_id")
            .lean();

        if (regs.length === 0) {
            return res.json([]);
        }

        const eventIds = regs.map((r) => r.event_id);

        // 2) fetch completed/cancelled events only
        const events = await Event.find({
            _id: { $in: eventIds },
            status: { $in: ["Completed", "Cancelled"] },
        })
            .sort({ end_date: -1 })
            .lean();

        return res.json(
            events.map((e) => ({
                id: e._id.toString(),
                ...e,
            }))
        );
    } catch (err) {
        console.error("Past events error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to fetch past events",
        });
    }
});


router.get("/Categories", async (req, res) => {
    try {
        // ===== JWT CHECK (INLINE) =====
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
            ({ payload } = await jwtVerify(token, secret));
        } catch {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // ===== LOAD USER + ROLE GATE =====
        const user = await User.findById(userId).select("_id role").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
                role: user.role,
            });
        }

        // ===== GET ATTENDED EVENTS FROM RegisteredEvent (SOURCE OF TRUTH) =====
        const regs = await RegisteredEvent.find({
            user_id: user._id,
            turn_up: true, // only events they actually attended
        })
            .populate("event_id", "category end_date")
            .lean();

        if (!regs.length) {
            return res.json([]);
        }

        // Sort by event end_date (latest first)
        regs.sort((a, b) => {
            const aDate = a.event_id?.end_date ? new Date(a.event_id.end_date) : new Date(0);
            const bDate = b.event_id?.end_date ? new Date(b.event_id.end_date) : new Date(0);
            return bDate - aDate; // latest first
        });

        // Pick up to 3 unique categories in order
        const categories = [];
        for (const reg of regs) {
            const cat = reg.event_id?.category;
            if (cat && !categories.includes(cat)) {
                categories.push(cat);
            }
            if (categories.length === 3) break;
        }

        return res.json(categories);
    } catch (err) {
        console.error("Categories error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to fetch categories",
        });
    }
});



router.get("/VerifyRole", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ valid: false });
        }

        const token = authHeader.split(" ")[1];
        const { payload } = await jwtVerify(token, secret);

        const user = await User.findById(payload.user_id).select("role");
        if (!user) {
            return res.status(401).json({ valid: false });
        }

        return res.json({
            valid: true,
            role: user.role, // "Student" | "Organiser" | "ADMIN"
        });

    } catch (err) {
        return res.status(401).json({ valid: false });
    }
});

// GET /Profile/Me
// Returns the logged-in user's safe profile (token is the source of truth)
router.get("/Me", async (req, res) => {
    try {
        // ===== JWT AUTH =====
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
        } catch (err) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // ===== GET USER =====
        const user = await User.findById(userId).lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
            });
        }

        // remove sensitive fields
        const { password, __v, ...safeUser } = user;

        return res.json({
            success: true,
            code: "ME_OK",
            user: { id: safeUser._id.toString(), ...safeUser },
        });
    } catch (err) {
        console.error("GET /Profile/Me error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});

/**
 * GET /AdminMe
 * Returns admin's username + profile image for sidebar
 */
router.get("/AdminMe", async (req, res) => {
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
        } catch {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload.user_id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // ===== LOAD USER =====
        const user = await User.findById(userId)
            .select("username profile_image role")
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        if (user.role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Admin only",
            });
        }

        return res.json({
            success: true,
            admin: {
                id: user._id.toString(),
                username: user.username,
                profile_image: user.profile_image || "/user_profile/UserBABY.png",
                role: user.role,
            },
        });
    } catch (err) {
        console.error("GET /Admin/Me error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});



export default router;