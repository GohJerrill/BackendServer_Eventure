// Routes/Bookmarks.js
import express from "express";
import { jwtVerify } from "jose";
import Bookmark from "../Models/BookmarksModel.js";
import Event from "../Models/EventsModel.js";
import RegisteredEvent from "../Models/RegisteredEventModel.js";
import User from "../Models/UserModel.js";

const router = express.Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/* ======================================================
   GET /Bookmarks
   Returns bookmarked events for logged-in user
   ====================================================== */
router.get("/", async (req, res) => {
    try {
        // ===== JWT AUTH =====
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Authentication required" });
        }

        const token = authHeader.split(" ")[1];
        const { payload } = await jwtVerify(token, secret);
        const userId = payload.user_id;

        const user = await User.findById(userId).select("role").lean();
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

        // ===== FETCH DATA =====
        const [bookmarks, registrations] = await Promise.all([
            Bookmark.find({ user: userId }).lean(),
            RegisteredEvent.find({ user_id: userId }).lean(),
        ]);

        if (bookmarks.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const eventIds = bookmarks.map(b => b.event.toString());

        const events = await Event.find({
            _id: { $in: eventIds }
        }).lean();

        // ===== REGISTRATION MAP =====
        const regMap = {};
        registrations.forEach(r => {
            regMap[r.event_id.toString()] = {
                reg_id: r._id.toString(),
                is_registered: true,
                turn_up: r.turn_up === true,
                scanned_at: r.scanned_at || null,
                rejected: r.rejected === true,
                rejected_at: r.rejected_at || null,
            };
        });

        // ===== STATUS PRIORITY =====
        const STATUS_PRIORITY = {
            Available: 1,
            Unavailable: 2,
            Completed: 3,
            Cancelled: 4,
        };

        // ===== BUILD RESPONSE =====
        const enriched = events
            .map(event => {
                const reg = regMap[event._id.toString()];

                return {
                    id: event._id.toString(),
                    ...event,
                    is_registered: !!reg,
                    turn_up: !!reg?.turn_up,
                    scanned_at: reg?.scanned_at || null,
                    reg_id: reg?.reg_id || null,
                    rejected: !!reg?.rejected,
                    rejected_at: reg?.rejected_at || null,
                };
            })
            .sort((a, b) => {
                const statusDiff =
                    (STATUS_PRIORITY[a.status] ?? 0) -
                    (STATUS_PRIORITY[b.status] ?? 0);

                if (statusDiff !== 0) return statusDiff;

                const dateA = new Date(a.start_date);
                const dateB = new Date(b.start_date);

                if (a.status === "Available" || a.status === "Unavailable") {
                    return dateA - dateB;
                }

                return dateB - dateA;
            });

        return res.json({
            success: true,
            data: enriched,
        });

    } catch (err) {
        console.error("Error fetching bookmarks:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch bookmarked events",
        });
    }
});

/* ======================================================
   POST /Bookmarks
   body: { eventId }
   Adds bookmark for logged-in user
   ====================================================== */
router.post("/", async (req, res) => {
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
        } catch {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid token",
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

        const user = await User.findById(userId).select("role").lean();
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


        // ===== BODY VALIDATION =====
        const { eventId } = req.body;
        if (!eventId) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "eventId is required",
            });
        }

        // ===== EVENT EXISTS =====
        const eventExists = await Event.exists({ _id: eventId });
        if (!eventExists) {
            return res.status(404).json({
                success: false,
                code: "EVENT_NOT_FOUND",
                message: "Event not found",
            });
        }

        // ===== CREATE BOOKMARK (duplicate safe) =====
        try {
            await Bookmark.create({ user: userId, event: eventId });
        } catch (e) {
            // Duplicate key -> already bookmarked
            if (e?.code === 11000) {
                return res.json({
                    success: true,
                    code: "ALREADY_BOOKMARKED",
                    message: "Already bookmarked",
                });
            }
            throw e;
        }

        return res.json({
            success: true,
            code: "BOOKMARK_ADDED",
            message: "Bookmark added",
        });
    } catch (err) {
        console.error("Error adding bookmark:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to add bookmark",
        });
    }
});


/* ======================================================
   DELETE /Bookmarks/:eventId
   Removes bookmark for logged-in user by eventId
   ====================================================== */
router.delete("/:eventId", async (req, res) => {
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
        } catch {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid token",
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

        const user = await User.findById(userId).select("role").lean();
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


        const { eventId } = req.params;

        const deleted = await Bookmark.findOneAndDelete({
            user: userId,
            event: eventId,
        }).lean();

        if (!deleted) {
            return res.status(404).json({
                success: false,
                code: "BOOKMARK_NOT_FOUND",
                message: "Bookmark not found",
            });
        }

        return res.json({
            success: true,
            code: "BOOKMARK_REMOVED",
            message: "Bookmark removed",
        });
    } catch (err) {
        console.error("Error removing bookmark:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to remove bookmark",
        });
    }
});


export default router;
