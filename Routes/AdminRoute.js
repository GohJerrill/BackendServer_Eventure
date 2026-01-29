import express from "express";
import { jwtVerify } from "jose";
import Event from "../Models/EventsModel.js";
import RegisteredEvent from "../Models/RegisteredEventModel.js";
import User from "../Models/UserModel.js";

import Bookmark from "../Models/BookmarksModel.js";
import Notification from "../Models/NotificationModel.js";
import QRCode from "qrcode";
import mongoose from "mongoose";

const router = express.Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/* ======================================================
   GET /Admin/DashboardStats
   Admin-only dashboard summary
   ====================================================== */
router.get("/DashboardStats", async (req, res) => {
    try {


        // ===== JWT CHECK =====
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const token = authHeader.split(" ")[1];
        const { payload } = await jwtVerify(token, secret);

        // ===== ROLE CHECK =====
        if (payload.role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Admin access only",
            });
        }

        // ===== DATA FETCH =====
        const [totalEvents, totalRegistrations, totalStudents] =
            await Promise.all([
                Event.countDocuments(),
                RegisteredEvent.countDocuments(),
                User.countDocuments({ role: "Student" }),
            ]);

        return res.json({
            success: true,
            data: {
                total_events: totalEvents,
                total_registrations: totalRegistrations,
                total_users: totalStudents,
            },
        });
    } catch (err) {
        console.error("Admin dashboard stats error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
});

router.get("/Events", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({ success: false });
        }

        const token = authHeader.split(" ")[1];
        const { payload } = await jwtVerify(token, secret);

        if (payload.role !== "ADMIN") {
            return res.status(403).json({ success: false });
        }

        const events = await Event.find().lean();

        res.json({
            success: true,
            events: events.map(e => ({
                id: e._id.toString(),
                ...e
            }))
        });

    } catch (err) {
        console.error("Admin events fetch error:", err);
        res.status(500).json({ success: false });
    }
});

// GET /Admin/Users
router.get("/Users", async (req, res) => {
    // ===== JWT CHECK =====
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
        });
    }

    const token = authHeader.split(" ")[1];

    // ===== VERIFY JWT =====
    let payload;
    try {
        ({ payload } = await jwtVerify(token, secret));
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    // ===== ROLE CHECK =====
    if (payload.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Admin access only",
        });
    }

    try {
        // ===== 1) FETCH STUDENT USERS =====
        const students = await User.find({ role: "Student" }).lean();

        if (students.length === 0) {
            return res.json({
                success: true,
                data: [],
            });
        }

        // Grab all student IDs
        const studentIds = students.map((s) => s._id);

        // ===== 2) BUILD ATTENDANCE COUNTS FROM RegisteredEvent =====
        // Count how many events each user has actually attended (turn_up: true)
        const attendanceAgg = await RegisteredEvent.aggregate([
            {
                $match: {
                    user_id: { $in: studentIds },
                    turn_up: true,
                },
            },
            {
                $group: {
                    _id: "$user_id",
                    attendedCount: { $sum: 1 },
                },
            },
        ]);

        // Turn aggregation result into a lookup map
        const attendanceMap = new Map();
        attendanceAgg.forEach((row) => {
            attendanceMap.set(row._id.toString(), row.attendedCount);
        });

        // ===== 3) SORT BY total_points DESC =====
        students.sort((a, b) => (b.total_points || 0) - (a.total_points || 0));

        // ===== 4) FORMAT RESPONSE =====
        const formattedUsers = students.map((u) => {
            const idStr = u._id.toString();
            const attendedCount = attendanceMap.get(idStr) || 0;

            return {
                id: idStr,
                username: u.username,
                student_email: u.student_email,
                profile_image: u.profile_image,
                total_points: u.total_points ?? 0,
                attended_events_count: attendedCount,       
                joined_at: u.createdAt ?? null,      
            };
        });

        return res.json({
            success: true,
            data: formattedUsers,
        });
    } catch (err) {
        console.error("Admin get users error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
});

// GET /Admin/Events/:eventId/Statistics
router.get("/EventsStatistics/:eventId", async (req, res) => {
    // ===== JWT CHECK =====
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const token = authHeader.split(" ")[1];

    // ===== VERIFY JWT =====
    let payload;
    try {
        ({ payload } = await jwtVerify(token, secret));
    } catch (err) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    // ===== ROLE CHECK =====
    if (payload.role !== "ADMIN") {
        return res.status(403).json({ success: false, message: "Admin access only" });
    }

    const { eventId } = req.params;

    try {
        // 1) Find event
        const event = await Event.findById(eventId).lean();
        if (!event) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }

        // 2) Get registrations for this event
        const regs = await RegisteredEvent.find({ event_id: eventId }).lean();

        // 3) Get all related users in 1 query
        const userIds = regs.map(r => r.user_id).filter(Boolean);
        const users = await User.find({ _id: { $in: userIds } }).lean();

        // build map for fast lookup
        const userMap = new Map(users.map(u => [u._id.toString(), u]));

        // 4) Enrich records
        const records = regs.map(reg => {
            const u = userMap.get(String(reg.user_id)) || null;

            return {
                id: reg._id.toString(),
                student_email: u?.student_email ?? "Unknown",
                username: u?.username ?? "Unknown",
                date_registered: reg.date_registered ?? null,
                turn_up: reg.turn_up ?? false,
                scanned_at: reg.scanned_at ?? null,
                createdAt: reg.createdAt ?? null,
            };
        });

        // 5) Sort: turn_up true first
        records.sort((a, b) => Number(b.turn_up) - Number(a.turn_up));

        // 6) Stats
        const total_registered = records.length;
        const total_turn_up = records.filter(r => r.turn_up).length;

        return res.json({
            success: true,
            data: {
                event: {
                    id: event._id.toString(),
                    title: event.title,
                    organiser: event.organiser,
                    image: event.image,
                },
                total_registered,
                total_turn_up,
                records,
            },
        });

    } catch (err) {
        console.error("Admin event statistics error:", err);
        return res.status(500).json({ success: false, message: "Failed to load event statistics" });
    }
});

// DELETE /Admin/DeleteEvents/:eventId
router.delete("/DeleteEvents/:eventId", async (req, res) => {
    try {
        // =========================
        // 1) JWT AUTH (INLINE)
        // =========================
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

        // =========================
        // 2) ROLE GATE (ADMIN ONLY)
        // =========================
        const user = await User.findById(userId).select("role").lean();
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

        // =========================
        // 3) VALIDATE PARAM + LOAD EVENT
        // =========================
        const { eventId } = req.params;

        const event = await Event.findById(eventId).lean();
        if (!event) {
            return res.status(404).json({
                success: false,
                code: "EVENT_NOT_FOUND",
                message: "Event not found",
            });
        }

        // =========================
        // 4) FIND REGISTRATIONS (for notification + delete)
        // =========================
        const registrations = await RegisteredEvent.find({
            event_id: eventId,
        }).lean();

        const uniqueUserIds = [
            ...new Set(registrations.map((r) => r.user_id?.toString()).filter(Boolean)),
        ];

        // =========================
        // 5) NOTIFY USERS
        // =========================
        if (uniqueUserIds.length > 0) {
            const notifDocs = uniqueUserIds.map((uid) => ({
                user: uid,                 // uid is the ObjectId string
                type: "Event",
                message: `The event "${event.title}" has been removed and is no longer available.`,
                event: event._id,          // required because type === "Event"
                is_read: false,
                icon: "/notifications/calendar.png", // correct field name
            }));

            await Notification.insertMany(notifDocs, { ordered: false });
        }


        // =========================
        // 6) DELETE REGISTRATIONS
        // =========================
        await RegisteredEvent.deleteMany({ event_id: eventId });

        // =========================
        // 7) DELETE BOOKMARKS
        // =========================
        await Bookmark.deleteMany({ event: eventId });

        // =========================
        // 8) DELETE EVENT LAST
        // =========================
        await Event.deleteOne({ _id: eventId });

        return res.json({
            success: true,
            code: "EVENT_DELETED",
            message: "Event deleted successfully",
        });
    } catch (err) {
        console.error("Admin delete event error:", err?.message, err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to delete event",
        });
    }
});

// POST /Admin/CreateEvents
router.post("/CreateEvents", async (req, res) => {
    try {
        // =========================
        // 1) JWT AUTH (INLINE)
        // =========================
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

        // =========================
        // 2) ROLE GATE (ADMIN ONLY)
        // =========================
        const user = await User.findById(userId).select("role").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        // Normalize role just in case your DB has "Admin"/"ADMIN"
        const role = String(user.role || "").toUpperCase();
        if (role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Admin only",
            });
        }

        // =========================
        // 3) BODY VALIDATION
        // =========================
        const requiredFields = [
            "title",
            "description",
            "school",
            "category",
            "type",
            "start_date",
            "end_date",
            "status",
            "organiser",
            "venue",
            "max_capacity",
            "points",
            "image"
        ];

        for (const field of requiredFields) {
            if (
                req.body[field] === undefined ||
                req.body[field] === null ||
                req.body[field] === ""
            ) {
                return res.status(400).json({
                    success: false,
                    code: "BAD_REQUEST",
                    message: `Missing required field: ${field}`,
                });
            }
        }

        // =========================
        // 4) PARSE SG "datetime-local" -> UTC Date
        // start_date/end_date from <input type="datetime-local" />
        // Example: "2026-01-29T14:00" means 2pm Singapore (UTC+8)
        // We convert to UTC by subtracting 8 hours.
        // =========================
        const startStr = String(req.body.start_date);
        const endStr = String(req.body.end_date);

        const [sDatePart, sTimePart] = startStr.split("T");
        const [eDatePart, eTimePart] = endStr.split("T");

        if (!sDatePart || !sTimePart || !eDatePart || !eTimePart) {
            return res.status(400).json({
                success: false,
                code: "INVALID_DATE",
                message: "Invalid date format (expected datetime-local)",
            });
        }

        const [sy, sm, sd] = sDatePart.split("-").map(Number);
        const [sh, smin] = sTimePart.split(":").map(Number);

        const [ey, em, ed] = eDatePart.split("-").map(Number);
        const [eh, emin] = eTimePart.split(":").map(Number);

        const validNums =
            [sy, sm, sd, sh, smin, ey, em, ed, eh, emin].every((n) =>
                Number.isFinite(n)
            );

        if (!validNums) {
            return res.status(400).json({
                success: false,
                code: "INVALID_DATE",
                message: "Invalid date numbers",
            });
        }

        // Convert SG local -> UTC by subtracting 8 hours
        const startDate = new Date(Date.UTC(sy, sm - 1, sd, sh - 8, smin, 0));
        const endDate = new Date(Date.UTC(ey, em - 1, ed, eh - 8, emin, 0));

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return res.status(400).json({
                success: false,
                code: "INVALID_DATE",
                message: "Invalid date format",
            });
        }

        // =========================
        // 5) DATE RULES (NOW IS UTC)
        // If you want "now" from SG perspective, compare against UTC is fine
        // because startDate/endDate are now UTC-correct.
        // =========================
        const now = new Date();

        if (startDate < now) {
            return res.status(400).json({
                success: false,
                code: "START_IN_PAST",
                message: "Start date cannot be in the past",
            });
        }

        if (endDate <= startDate) {
            return res.status(400).json({
                success: false,
                code: "END_BEFORE_START",
                message: "End date must be after start date",
            });
        }

        // =========================
        // 6) NORMALIZE NUMBERS
        // =========================
        const maxCapacity = Number(req.body.max_capacity);
        const points = Number(req.body.points);
        const attendees =
            req.body.attendees !== undefined && req.body.attendees !== null && req.body.attendees !== ""
                ? Number(req.body.attendees)
                : 0;

        if (!Number.isFinite(maxCapacity) || maxCapacity <= 0) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "max_capacity must be a positive number",
            });
        }

        if (!Number.isFinite(points) || points < 0) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "points must be a valid number (>= 0)",
            });
        }

        if (!Number.isFinite(attendees) || attendees < 0) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "attendees must be a valid number (>= 0)",
            });
        }

        if (attendees > maxCapacity) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "attendees cannot exceed max_capacity",
            });
        }

        // =========================
        // 7) DEFAULTS + LOCK
        // =========================
        const capacityLocked = req.body.status !== "Available";

        const image = req.body.image;
        const organiserImage = req.body.organiser_image || "/organiser/TP.png";
        const tpLocation = Boolean(req.body.TP_Location);

        // Basic sanity for huge base64 (prevents 413 / giant docs)

        // =========================
        // 8) CREATE EVENT
        // =========================
        const created = await Event.create({
            title: String(req.body.title).trim(),
            description: req.body.description, // keep HTML
            school: req.body.school,
            category: req.body.category,
            type: req.body.type,

            start_date: startDate,
            end_date: endDate,

            status: req.body.status,
            capacity_locked: capacityLocked,

            organiser: req.body.organiser,
            organiser_image: organiserImage,

            venue: req.body.venue,
            TP_Location: tpLocation,

            image,

            attendees,
            max_capacity: maxCapacity,

            points,
        });

        const obj = created.toObject();
        const { _id, __v, ...rest } = obj;

        return res.status(201).json({
            success: true,
            code: "EVENT_CREATED",
            event: {
                id: _id.toString(),
                ...rest,
            },
        });
    } catch (err) {
        console.error("Admin create event error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to create event",
        });
    }
});

// GET /Admin/AdminGetEVENTS/:eventId
router.get("/AdminGetEVENTS/:eventId", async (req, res) => {
    try {
        // =========================
        // 1) JWT AUTH (INLINE)
        // =========================
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

        // =========================
        // 2) ROLE GATE (ADMIN ONLY)
        // =========================
        const user = await User.findById(userId).select("role").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        const role = String(user.role || "").toUpperCase();
        if (role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Admin only",
            });
        }

        // =========================
        // 3) LOAD EVENT
        // =========================
        const { eventId } = req.params;

        const event = await Event.findById(eventId).lean();
        if (!event) {
            return res.status(404).json({
                success: false,
                code: "EVENT_NOT_FOUND",
                message: "Event not found",
            });
        }

        return res.json({
            success: true,
            code: "EVENT_OK",
            event: {
                id: event._id.toString(),
                ...event,
            },
        });
    } catch (err) {
        console.error("Admin get event error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to fetch event",
        });
    }
});

// POST /Admin/ResetLeaderboardPoints
router.post("/ResetLeaderboardPoints", async (req, res) => {
    try {
        // =========================
        // 1) JWT AUTH (INLINE)
        // =========================
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

        const adminId = payload.user_id;
        if (!adminId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // =========================
        // 2) ROLE GATE (ADMIN ONLY)
        // =========================
        const adminUser = await User.findById(adminId).select("role").lean();
        if (!adminUser) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        if (String(adminUser.role || "").toUpperCase() !== "ADMIN") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Admin only",
            });
        }

        // =========================
        // 3) LOAD STUDENTS
        // =========================
        const students = await User.find({ role: "Student" })
            .select("_id")
            .lean();

        if (!students.length) {
            return res.json({
                success: true,
                code: "NO_STUDENTS",
                reset_count: 0,
                message: "No students found to reset",
            });
        }

        // =========================
        // 4) RESET MONTH (SG TIME)
        // =========================
        const now = new Date();
        const resetMonth = new Intl.DateTimeFormat("en-GB", {
            month: "long",
            year: "numeric",
            timeZone: "Asia/Singapore",
        }).format(now);

        // =========================
        // 5) BULK RESET POINTS
        // =========================
        const studentIds = students.map((s) => s._id);
        const resetRes = await User.updateMany(
            { _id: { $in: studentIds } },
            { $set: { total_points: 0 } }
        );

        // =========================
        // 6) BULK NOTIFICATIONS
        // =========================
        const notifDocs = studentIds.map((uid) => ({
            user: uid,
            type: "Season_Reset",
            message: `The leaderboard has been reset for ${resetMonth}. A new season has begun — All the Best!`,
            is_read: false,
            icon: "/notifications/Leaderboards.png",
        }));

        await Notification.insertMany(notifDocs);

        return res.json({
            success: true,
            code: "LEADERBOARD_RESET",
            reset_count: students.length,
            matched: resetRes.matchedCount ?? resetRes.n ?? undefined,
            modified: resetRes.modifiedCount ?? resetRes.nModified ?? undefined,
            month: resetMonth,
        });
    } catch (err) {
        console.error("Reset leaderboard points error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to reset leaderboard points",
        });
    }
});



// PUT /Admin/UpdateEvents/:eventId
router.put("/UpdateEvents/:eventId", async (req, res) => {
    try {
        // =========================
        // 1) JWT AUTH 
        // =========================
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Authentication required",
            });
        }

        const token = authHeader.split(" ")[1];

        let payloadJwt;
        try {
            ({ payload: payloadJwt } = await jwtVerify(token, secret));
        } catch {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payloadJwt.user_id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // =========================
        // 2) ROLE GATE (ADMIN ONLY)
        // =========================
        const user = await User.findById(userId).select("role").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        const role = String(user.role || "").toUpperCase();
        if (role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Admin only",
            });
        }

        // =========================
        // 3) LOAD EXISTING EVENT
        // =========================
        const { eventId } = req.params;

        const existingEvent = await Event.findById(eventId).lean();
        if (!existingEvent) {
            return res.status(404).json({
                success: false,
                code: "EVENT_NOT_FOUND",
                message: "Event not found",
            });
        }

        const now = new Date();

        const originalStart = new Date(existingEvent.start_date);
        const originalEnd = new Date(existingEvent.end_date);

        // =========================
        // 4) PARSE SG datetime-local -> UTC Date (INLINE)
        // =========================
        const parseSgDatetimeLocalToUtcDate = (value) => {
            // expects "YYYY-MM-DDTHH:mm"
            const str = String(value || "");
            const [datePart, timePart] = str.split("T");
            if (!datePart || !timePart) return null;

            const [y, m, d] = datePart.split("-").map(Number);
            const [hh, mm] = timePart.split(":").map(Number);

            const valid = [y, m, d, hh, mm].every((n) => Number.isFinite(n));
            if (!valid) return null;

            // SG = UTC+8, convert to UTC by subtracting 8 hours
            return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0));
        };

        const normalizeIncomingDate = (val) => {
            if (val === undefined || val === null || val === "") return null;

            if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) {
                return parseSgDatetimeLocalToUtcDate(val);
            }

            const d = new Date(val);
            return Number.isNaN(d.getTime()) ? null : d;
        };

        const incomingStart =
            req.body.start_date !== undefined ? normalizeIncomingDate(req.body.start_date) : null;
        const incomingEnd =
            req.body.end_date !== undefined ? normalizeIncomingDate(req.body.end_date) : null;

        // if provided but invalid
        if (req.body.start_date !== undefined && !incomingStart) {
            return res.status(400).json({
                success: false,
                code: "INVALID_DATE",
                message: "Invalid start_date format",
            });
        }
        if (req.body.end_date !== undefined && !incomingEnd) {
            return res.status(400).json({
                success: false,
                code: "INVALID_DATE",
                message: "Invalid end_date format",
            });
        }

        const newStart = incomingStart || originalStart;
        const newEnd = incomingEnd || originalEnd;

        const startChanged =
            incomingStart ? incomingStart.getTime() !== originalStart.getTime() : false;
        const endChanged =
            incomingEnd ? incomingEnd.getTime() !== originalEnd.getTime() : false;

        // =========================
        // 5) DATE RULES (only when changed)
        // =========================
        if (startChanged || endChanged) {
            if (newEnd <= newStart) {
                return res.status(400).json({
                    success: false,
                    code: "END_BEFORE_START",
                    message: "End date must be after start date",
                });
            }

            if (startChanged && newStart < now) {
                return res.status(400).json({
                    success: false,
                    code: "START_IN_PAST",
                    message: "Start date cannot be in the past",
                });
            }

            if (endChanged && newEnd < now) {
                return res.status(400).json({
                    success: false,
                    code: "END_IN_PAST",
                    message: "End date cannot be in the past",
                });
            }
        }

        // =========================
        // 6) STATUS RULES (ANTI-FAKE)
        // =========================
        const incomingStatus =
            req.body.status !== undefined ? req.body.status : existingEvent.status;

        if (incomingStatus === "Completed" && now < newEnd) {
            return res.status(400).json({
                success: false,
                code: "INVALID_STATUS",
                message: "Cannot mark event as Completed before it ends",
            });
        }

        if (incomingStatus === "Available" && now > newEnd) {
            return res.status(400).json({
                success: false,
                code: "INVALID_STATUS",
                message: "Cannot reopen an event that has ended",
            });
        }

        // =========================
        // 7) CAPACITY LOCK DERIVED
        // =========================
        const capacity_locked =
            incomingStatus === "Unavailable" ||
            incomingStatus === "Cancelled" ||
            incomingStatus === "Completed";

        // =========================
        // 8) BUILD UPDATE OBJECT
        // =========================
        const update = {};

        const allowed = [
            "title",
            "description",
            "school",
            "category",
            "type",
            "status",
            "organiser",
            "venue",
            "TP_Location",
            "image",
            "organiser_image",
            "max_capacity",
            "points",
            "attendees",
        ];

        for (const key of allowed) {
            if (req.body[key] !== undefined) update[key] = req.body[key];
        }

        // overwrite with normalized values
        update.status = incomingStatus;
        update.capacity_locked = capacity_locked;
        if (incomingStart) update.start_date = incomingStart;
        if (incomingEnd) update.end_date = incomingEnd;

        // numeric normalize (if sent)
        if (update.max_capacity !== undefined) update.max_capacity = Number(update.max_capacity);
        if (update.points !== undefined) update.points = Number(update.points);
        if (update.attendees !== undefined) update.attendees = Number(update.attendees);

        if (
            update.max_capacity !== undefined &&
            (!Number.isFinite(update.max_capacity) || update.max_capacity <= 0)
        ) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "max_capacity must be a positive number",
            });
        }

        if (
            update.points !== undefined &&
            (!Number.isFinite(update.points) || update.points < 0)
        ) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "points must be a valid number (>= 0)",
            });
        }

        if (
            update.attendees !== undefined &&
            (!Number.isFinite(update.attendees) || update.attendees < 0)
        ) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "attendees must be a valid number (>= 0)",
            });
        }

        // attendees cannot exceed max_capacity
        const finalMax =
            update.max_capacity !== undefined ? update.max_capacity : existingEvent.max_capacity;
        const finalAtt =
            update.attendees !== undefined ? update.attendees : existingEvent.attendees;

        if (
            Number.isFinite(finalMax) &&
            Number.isFinite(finalAtt) &&
            finalAtt > finalMax
        ) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "attendees cannot exceed max_capacity",
            });
        }

        // =========================
        // 9) DETECT "NO CHANGES"
        // =========================
        let hasAnyChange = false;

        // 9a) dates
        if (startChanged || endChanged) {
            hasAnyChange = true;
        } else {
            // 9b) other fields to compare
            const fieldsToCompare = [
                "title",
                "description",
                "school",
                "category",
                "type",
                "status",
                "organiser",
                "venue",
                "TP_Location",
                "image",
                "organiser_image",
                "max_capacity",
                "points",
                "attendees",
                "capacity_locked",
            ];

            for (const field of fieldsToCompare) {
                const newVal =
                    field in update ? update[field] : existingEvent[field];
                const oldVal = existingEvent[field];

                if (newVal instanceof Date && oldVal instanceof Date) {
                    if (newVal.getTime() !== oldVal.getTime()) {
                        hasAnyChange = true;
                        break;
                    }
                } else if (newVal !== oldVal) {
                    hasAnyChange = true;
                    break;
                }
            }
        }

        if (!hasAnyChange) {
            // nothing actually changed → no DB update, no notifications
            return res.json({
                success: true,
                code: "NO_CHANGES",
                message: "No changes detected; event was not updated.",
                event: {
                    id: existingEvent._id.toString(),
                    ...existingEvent,
                },
            });
        }

        // =========================
        // 10) UPDATE EVENT
        // =========================
        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            { $set: update },
            { new: true }
        ).lean();

        // =========================
        // 11) NOTIFY REGISTERED USERS
        // (only reached when there ARE changes)
        // =========================
        const registrations = await RegisteredEvent.find({ event_id: eventId })
            .select("user_id")
            .lean();

        const uniqueUserIds = [
            ...new Set(
                registrations.map((r) => r.user_id?.toString()).filter(Boolean)
            ),
        ];

        if (uniqueUserIds.length > 0) {
            const notifDocs = uniqueUserIds.map((uid) => ({
                user: uid,
                type: "Event",
                message: `The event "${updatedEvent.title}" has been updated. Please review the latest details.`,
                event: updatedEvent._id,
                is_read: false,
                icon: "/notifications/calendar.png",
            }));

            await Notification.insertMany(notifDocs);
        }

        return res.json({
            success: true,
            code: "EVENT_UPDATED",
            event: {
                id: updatedEvent._id.toString(),
                ...updatedEvent,
            },
        });
    } catch (err) {
        console.error("Admin update event error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to update event",
        });
    }
});






export default router;
