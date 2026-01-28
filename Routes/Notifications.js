// routes/Notifications.js
import express from "express";
import { jwtVerify } from "jose";
import Notification from "../Models/NotificationModel.js";
import RegisteredEvent from "../Models/RegisteredEventModel.js";
import Event from "../Models/EventsModel.js";
import User from "../Models/UserModel.js";

const router = express.Router();

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/* ======================================================
   1) GET UNREAD NOTIFICATION COUNT
   GET /Notifications/UnreadCount
   Frontend: GetUnreadNotificationCount()
   ====================================================== */
router.get("/UnreadCount", async (req, res) => {
    try {
        // JWT CHECK (INLINE)
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false });
        }

        const token = authHeader.split(" ")[1];
        const { payload } = await jwtVerify(token, secret);
        const userId = payload.user_id;

        const unreadCount = await Notification.countDocuments({
            user: userId,
            is_read: false,
        });

        return res.json({
            success: true,
            unreadCount,
        });
    } catch (err) {
        console.error("Error getting unread count:", err);
        return res.status(500).json({
            success: false,
            unreadCount: 0,
        });
    }
});

/* ======================================================
   2) GET INBOX NOTIFICATIONS
   GET /Notifications/Inbox
   Frontend: GetInboxNotifications()
   ====================================================== */
router.get("/Inbox", async (req, res) => {
    const authHeader = req.headers.authorization;

    // 1) Missing auth header → 401
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
        console.error("Invalid or expired token (Inbox):", err);
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    const userId = payload.user_id;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
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

    // if you want Student-only:
    if (user.role !== "Student") {
        return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            message: "Students only",
        });
    }

    // 3) Main DB logic in another try/catch
    try {
        const notifications = await Notification.find({
            user: userId,
        })
            .sort({ is_read: 1, createdAt: -1 }) // unread first, newest first
            .lean();

        return res.json({
            success: true,
            data: notifications,
        });
    } catch (err) {
        console.error("Error fetching inbox notifications:", err);
        return res.status(500).json({
            success: false,
            message: "Cannot fetch inbox notifications",
        });
    }
});


/* ======================================================
   3) GET IMPORTANT EVENT NOTIFICATIONS
   GET /Notifications/Important
   Frontend: GetImportantNotifications()
   ====================================================== */
router.get("/Important", async (req, res) => {
    const authHeader = req.headers.authorization;

    // 1) Check auth header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
        });
    }

    const token = authHeader.split(" ")[1];

    // 2) Verify JWT
    let payload;
    try {
        ({ payload } = await jwtVerify(token, secret));
    } catch (err) {
        console.error("Invalid or expired token (Important):", err);
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    const userId = payload.user_id;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
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

    // if you want Student-only:
    if (user.role !== "Student") {
        return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            message: "Students only",
        });
    }

    // 3) Main logic
    try {
        // Get user's registered events
        const registrations = await RegisteredEvent.find({
            user_id: userId,
        }).lean();

        if (registrations.length === 0) {
            return res.json({
                success: true,
                data: [],
            });
        }

        const eventIds = registrations.map((r) => r.event_id);

        const events = await Event.find({
            _id: { $in: eventIds },
            status: { $in: ["Available", "Unavailable"] },
        }).lean();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const importantEvents = events
            .map((event) => {
                const start = new Date(event.start_date);
                const end = new Date(event.end_date);

                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);

                const daysLeft = Math.round(
                    (start - today) / (1000 * 60 * 60 * 24)
                );

                const isTodayOrOngoing =
                    today.getTime() === start.getTime() ||
                    (today >= start && today <= end);

                const include =
                    isTodayOrOngoing || (daysLeft >= 0 && daysLeft <= 3);

                if (!include) return null;

                return {
                    id: event._id.toString(),
                    title: event.title,
                    image: event.image,
                    organiser: event.organiser,
                    start_date: event.start_date,
                    end_date: event.end_date,
                    location: event.location,
                    daysLeft,
                    isTodayOrOngoing,
                };
            })
            .filter(Boolean)
            .sort(
                (a, b) =>
                    new Date(a.start_date) - new Date(b.start_date)
            );

        return res.json({
            success: true,
            data: importantEvents,
        });
    } catch (err) {
        console.error("Error fetching important notifications:", err);
        return res.status(500).json({
            success: false,
            message: "Cannot fetch important notifications",
        });
    }
});


router.patch("/:id/NotificationsRead", async (req, res) => {
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

        // ===== UPDATE (ownership enforced in query) =====
        const notifId = req.params.id;

        const updated = await Notification.findOneAndUpdate(
            { _id: notifId, user: userId }, // ensures ownership
            { $set: { is_read: true } },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({
                success: false,
                code: "NOTIFICATION_NOT_FOUND",
                message: "Notification not found",
            });
        }

        return res.json({
            success: true,
            code: "MARKED_READ",
            notification: {
                id: updated._id.toString(),
                ...updated,
            },
        });
    } catch (err) {
        console.error("Mark one read error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});

// MARK ALL AS READ
// PATCH /Notification/MarkAllRead
router.patch("/MarkAllRead", async (req, res) => {
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

        // ===== UPDATE MANY =====
        const result = await Notification.updateMany(
            { user: userId, is_read: false },
            { $set: { is_read: true } }
        );

        // result.modifiedCount tells how many were updated
        return res.json({
            success: true,
            code: "MARKED_ALL_READ",
            modifiedCount: result.modifiedCount ?? 0,
        });
    } catch (err) {
        console.error("Mark all read error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});


export default router;
