// routes/events.js
import express from "express";

import Event from "../Models/EventsModel.js";
import RegisteredEvent from "../Models/RegisteredEventModel.js";
import Bookmark from "../Models/BookmarksModel.js";
import Notification from "../Models/NotificationModel.js";
import User from "../Models/UserModel.js";
import Badge from "../Models/BadgesModel.js";

import QRCode from "qrcode";
import mongoose from "mongoose";



const router = express.Router();


import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

function FormatReturn(doc) {
    // If it's a Mongoose document, convert it; if it's already a plain object, just use it.
    const obj = doc.toObject ? doc.toObject() : doc;
    const { _id, __v, ...rest } = obj;

    return {
        id: _id.toString(),
        ...rest,
    };
}


const POINTS_CAP = 5000;

const REQUIRED_EVENT_CATEGORIES = [
    "Charity",
    "Conference",
    "Science",
    "Technology",
    "Social Events",
    "Camps",
    "Arts",
];

async function awardBadgesForUser(user, session) {
    if (!Array.isArray(user.badges)) {
        user.badges = [];
    }

    const allBadges = await Badge.find().session(session).lean();
    if (!allBadges.length) return [];

    const badgeById = {};
    for (const b of allBadges) {
        if (b.badgeId) badgeById[b.badgeId] = b;
    }

    const earnedIds = new Set(
        (user.badges || []).map((b) => b.badge?.toString())
    );

    const newBadges = [];

    const giveBadge = (badgeCode) => {
        const badgeDoc = badgeById[badgeCode];
        if (!badgeDoc) return;

        const idStr = badgeDoc._id.toString();
        if (earnedIds.has(idStr)) return;

        user.badges.push({ badge: badgeDoc._id });
        earnedIds.add(idStr);
        newBadges.push({
            badgeId: badgeDoc.badgeId,
            name: badgeDoc.name,
        });
    };

    // ========= Build attended events (truth from RegisteredEvent) =========
    const regDocs = await RegisteredEvent.find({
        user_id: user._id,
        turn_up: true,
    })
        .populate("event_id", "school category start_date")
        .session(session);

    const attendedEvents = regDocs
        .map((r) => r.event_id)
        .filter(Boolean);

    const attendedCount = attendedEvents.length;

    // B1 First Steps
    if (attendedCount >= 1) giveBadge("B1");

    // B2 IIT Explorer – 3 IIT events
    const iitEvents = attendedEvents.filter(
        (e) => e.school === "IIT"
    ).length;
    if (iitEvents >= 3) giveBadge("B2");

    // B3 Socialising – 5 Social Events
    const socialEvents = attendedEvents.filter(
        (e) => e.category === "Social Events"
    ).length;
    if (socialEvents >= 5) giveBadge("B3");

    // B4 Consistency Champ – 3 events in same calendar month
    const byMonth = {};
    attendedEvents.forEach((e) => {
        const d = e.start_date ? new Date(e.start_date) : null;
        if (!d || Number.isNaN(d.getTime())) return;

        const key = `${d.getFullYear()}-${d.getMonth()}`;
        byMonth[key] = (byMonth[key] || 0) + 1;
    });
    if (Object.values(byMonth).some((count) => count >= 3)) {
        giveBadge("B4");
    }

    // B5 Knowledge Seeker – 3 Conference events
    const confEvents = attendedEvents.filter(
        (e) => e.category === "Conference"
    ).length;
    if (confEvents >= 3) giveBadge("B5");

    // B6 Gamified Guru – total_points >= 7000
    if ((user.total_points || 0) >= 7000) giveBadge("B6");

    // B7 Champ for the Month – highest total_points
    const allUsers = await User.find({})
        .select("total_points")
        .session(session)
        .lean();

    if (allUsers.length > 0) {
        const sorted = [...allUsers].sort(
            (a, b) => (b.total_points || 0) - (a.total_points || 0)
        );
        if (sorted[0]._id.toString() === user._id.toString()) {
            giveBadge("B7");
        }
    }

    // B8 Eventure Veteran – 20 attended events
    if (attendedCount >= 20) giveBadge("B8");

    // B9 Big Heart – 5 Charity events
    const charityEvents = attendedEvents.filter(
        (e) => e.category === "Charity"
    ).length;
    if (charityEvents >= 5) giveBadge("B9");

    // B10 Variety Baby – attended ALL required categories
    const attendedCategories = new Set(
        attendedEvents.map((e) => e.category)
    );
    const hasAllRequiredCategories = REQUIRED_EVENT_CATEGORIES.every((cat) =>
        attendedCategories.has(cat)
    );
    if (hasAllRequiredCategories) giveBadge("B10");

    // B12 TP Eventure (final) – has all other badges
    const finalBadgeDoc = badgeById["B12"];
    if (finalBadgeDoc) {
        const totalBadges = allBadges.length;
        const hasFinalAlready = earnedIds.has(finalBadgeDoc._id.toString());

        // After all non-final awards, if user has totalBadges - 1, give B12
        if (!hasFinalAlready && user.badges.length === totalBadges - 1) {
            giveBadge("B12");
        }
    }

    // user.save() is handled by caller
    return newBadges;
}




/* =========================
   1) HOMEPAGE EVENTS
   GET /Events
   - Only Available/Unavailable
   - Only future events
   - Adds is_registered flag
   ========================= */

router.get("/", async (req, res) => {
    try {
        const now = new Date();

        // =========================
        // 1) Fetch events (public)
        // =========================
        // Only upcoming events, status = Available / Unavailable
        const events = await Event.find({
            status: { $in: ["Available", "Unavailable"] },
            start_date: { $gte: now },
        })
            .sort({ start_date: 1 })
            .lean();

        // =========================
        // 2) Try to extract userId from JWT (optional)
        // =========================
        const authHeader = req.headers.authorization;
        let userId = null;

        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const token = authHeader.split(" ")[1];
                const { payload } = await jwtVerify(token, secret);

                if (payload?.user_id && typeof payload.user_id === "string") {
                    userId = payload.user_id;
                }
            } catch (err) {
                // Public route → ignore invalid token, but log for debugging
                console.warn("Invalid JWT on GET /Events (public):", err.message);
            }
        }

        // If somehow userId is weird, ignore it
        if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
            userId = null;
        }

        // =========================
        // 3) Load registrations only if logged in
        // =========================
        let registeredIds = new Set();

        if (userId) {
            const regs = await RegisteredEvent.find({ user_id: userId })
                .select("event_id")
                .lean();

            registeredIds = new Set(
                regs
                    .map((r) => r.event_id)
                    .filter(Boolean)
                    .map((id) => id.toString())
            );
        }

        // =========================
        // 4) Enrich response
        // =========================
        const enriched = events.map((e) => {
            const base = FormatReturn(e); // strips _id, __v, renames id
            return {
                ...base,
                is_registered: registeredIds.has(base.id),
            };
        });

        return res.json({
            success: true,
            events: enriched,
        });
    } catch (err) {
        console.error("Error in GET /Events:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Cannot fetch events",
        });
    }
});

router.get("/Individual/:id", async (req, res) => {
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

        // validate userId to avoid CastError
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid token user id",
            });
        }

        // validate event id BEFORE findById
        const eventId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({
                success: false,
                code: "INVALID_EVENT_ID",
                message: "Invalid event id",
            });
        }

        // ===== GET USER ROLE =====
        const user = await User.findById(userId).select("role").lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        const role = user.role;
        const isStudent = role === "Student";

        // ===== EVENT =====
        const event = await Event.findById(eventId).lean();
        if (!event) {
            return res.status(404).json({
                success: false,
                code: "EVENT_NOT_FOUND",
                message: "Event not found",
            });
        }

        // ===== If NOT student, return event only =====
        if (!isStudent) {
            return res.json({
                success: true,
                role,
                event: {
                    id: event._id.toString(),
                    ...event,
                    is_registered: false,
                    has_attended: false,
                    registration_id: null,
                    qr_code_ticket: null,
                    turn_up: false,
                    scanned_at: null,
                    is_bookmarked: false,
                },
            });
        }

        // ===== STUDENT: load registration + bookmark =====
        const [registration, bookmark] = await Promise.all([
            RegisteredEvent.findOne({ user_id: userId, event_id: event._id }).lean(),
            Bookmark.findOne({ user: userId, event: event._id }).lean(),
        ]);

        return res.json({
            success: true,
            role,
            event: {
                id: event._id.toString(),
                ...event,
                is_registered: !!registration,
                has_attended: !!registration?.scanned_at,
                registration_id: registration?._id?.toString() || null,
                qr_code_ticket: registration?.qr_code_ticket || null,
                turn_up: registration?.turn_up || false,
                scanned_at: registration?.scanned_at || null,
                is_bookmarked: !!bookmark,
            },
        });
    } catch (err) {
        console.error("Error fetching individual event:", err);

        if (err?.name === "CastError") {
            return res.status(400).json({
                success: false,
                code: "INVALID_EVENT_ID",
                message: "Invalid event id",
            });
        }

        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Cannot fetch event",
        });
    }
});



/**
 * GET /Events/CalendarMyEvents
 * Returns all events the logged-in user registered for
 */
router.get("/CalendarMyEvents", async (req, res) => {
    const authHeader = req.headers.authorization;

    // 1) Missing token → 401
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
        });
    }

    const token = authHeader.split(" ")[1];

    // 2) Verify token in its own try/catch
    let payload;
    try {
        ({ payload } = await jwtVerify(token, secret));
    } catch (err) {
        console.error("Invalid or expired token (CalendarMyEvents):", err);
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    const userId = payload.user_id;

    // 2.5) Get role (and gate)
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



    // 3) Main logic
    try {
        // Get registrations for this user
        const registrations = await RegisteredEvent.find({
            user_id: userId,
        }).lean();

        if (registrations.length === 0) {
            return res.json({
                success: true,
                events: [],
            });
        }

        // Get events
        const eventIds = registrations.map((r) => r.event_id.toString());

        const events = await Event.find({
            _id: { $in: eventIds },
        }).lean();

        // Merge registration + event data
        const enriched = registrations
            .map((reg) => {
                const event = events.find(
                    (e) => e._id.toString() === reg.event_id.toString()
                );
                if (!event) return null;

                return {
                    id: event._id.toString(),
                    title: event.title,
                    start_date: event.start_date,
                    category: event.category,
                    end_date: event.end_date,
                    location: event.location,
                    registration_id: reg._id.toString(),
                    date_registered: reg.createdAt,
                    status: event.status,
                    event_date: event.start_date.toISOString().split("T")[0],
                };
            })
            .filter(Boolean);

        return res.json({
            success: true,
            events: enriched,
        });
    } catch (err) {
        console.error("Error fetching calendar events:", err);
        return res.status(500).json({
            success: false,
            message: "Cannot fetch calendar events",
        });
    }
});


/**
 * GET /Events/CalendarTodayEvents
 * Returns today's events for the logged-in student
 */
router.get("/CalendarTodayEvents", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        // 1) Missing token → 401
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
            console.error("Invalid or expired token (CalendarTodayEvents):", err);
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

        // Optional but nice: ensure it’s a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                code: "BAD_USER_ID",
                message: "Invalid user id",
            });
        }

        // 2.5) Get role (and gate)
        const user = await User.findById(userId).select("role").lean();

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

        // 3) Main logic
        const registrations = await RegisteredEvent.find({
            user_id: userId,
        }).lean();

        if (registrations.length === 0) {
            return res.json({
                success: true,
                code: "NO_EVENTS",
                events: [],
            });
        }

        const eventIds = registrations
            .map((r) => r.event_id?.toString())
            .filter(Boolean);

        const events = await Event.find({
            _id: { $in: eventIds },
        }).lean();

        const now = new Date();

        // Start and end of *today* (server-local "today")
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);

        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);

        const todayEvents = registrations
            .map((reg) => {
                const event = events.find(
                    (e) => e._id.toString() === reg.event_id.toString()
                );
                if (!event) return null;

                const start = new Date(event.start_date);
                const end = new Date(event.end_date);

                // 1) Event overlaps today's date at all
                const overlapsToday = start <= endOfToday && end >= startOfToday;

                // 2) Event has not completely ended yet
                const notEnded = end >= now;

                if (!overlapsToday || !notEnded) return null;

                return {
                    id: event._id.toString(),
                    title: event.title,
                    category: event.category,
                    start_date: event.start_date,
                    end_date: event.end_date,
                    location: event.location,
                    status: event.status,
                    registration_id: reg._id.toString(),
                    date_registered: reg.createdAt,
                    event_date: event.start_date.toISOString().split("T")[0],
                };
            })
            .filter(Boolean);

        return res.json({
            success: true,
            code: "TODAY_OK",
            events: todayEvents,
        });
    } catch (err) {
        console.error("Error fetching today calendar:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Cannot fetch today calendar",
        });
    }
});



// GET /Events/:eventId/RegistrationUSER
router.get("/:eventId/RegistrationUSER", async (req, res) => {
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

        let payload;
        try {
            ({ payload } = await jwtVerify(token, secret));
        } catch (err) {
            console.error("Invalid or expired token (RegistrationUSER):", err);
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

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                code: "BAD_USER_ID",
                message: "Invalid user id",
            });
        }

        // =========================
        // 2) ROLE GATE (STUDENT ONLY)
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
        if (role !== "STUDENT") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
            });
        }

        // =========================
        // 3) PARAM VALIDATION
        // =========================
        const { eventId } = req.params;

        if (!eventId) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "eventId is required",
            });
        }

        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({
                success: false,
                code: "BAD_EVENT_ID",
                message: "Invalid event id",
            });
        }

        // =========================
        // 4) FIND REGISTRATION
        // =========================
        const reg = await RegisteredEvent.findOne({
            user_id: userId,
            event_id: eventId,
        }).lean();

        if (!reg) {
            return res.json({
                success: true,
                code: "NOT_REGISTERED",
                registration: null,
            });
        }

        const { _id, __v, ...rest } = reg;

        return res.json({
            success: true,
            code: "REGISTERED_OK",
            registration: {
                id: _id.toString(),
                ...rest,
            },
        });
    } catch (err) {
        console.error("Error in GET /Events/:eventId/RegistrationUSER:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to fetch registration",
        });
    }
});



// DELETE /Events/:eventId/UnregisterEvent
router.delete("/:eventId/UnregisterEvent", async (req, res) => {
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

        const userId = payload?.user_id;

        if (!userId || typeof userId !== "string") {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing or invalid user id",
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                code: "BAD_USER_ID",
                message: "Invalid user id",
            });
        }

        // =========================
        // 2) ROLE GATE (STUDENT ONLY)
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
        if (role !== "STUDENT") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Students only",
            });
        }

        // =========================
        // 3) PARAM VALIDATION
        // =========================
        const { eventId } = req.params;

        if (!eventId) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "eventId is required",
            });
        }

        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({
                success: false,
                code: "BAD_EVENT_ID",
                message: "Invalid event id",
            });
        }

        // =========================
        // 4) EVENT CHECK
        // =========================
        const event = await Event.findById(eventId).lean();
        if (!event) {
            return res.status(404).json({
                success: false,
                code: "EVENT_NOT_FOUND",
                message: "Event not found",
            });
        }

        if (event.status === "Cancelled" || event.status === "Completed") {
            return res.status(409).json({
                success: false,
                code: "EVENT_LOCKED",
                message: "Cannot modify attendance for this event",
            });
        }

        // =========================
        // 5) REGISTRATION CHECK
        // =========================
        const registration = await RegisteredEvent.findOne({
            user_id: userId,
            event_id: eventId,
        }).lean();

        if (!registration) {
            return res.status(404).json({
                success: false,
                code: "NOT_REGISTERED",
                message: "User is not registered",
            });
        }

        if (registration.scanned_at) {
            return res.status(409).json({
                success: false,
                code: "ALREADY_ATTENDED",
                message: "Attendance already confirmed and cannot be changed",
            });
        }

        // =========================
        // 6) DELETE REGISTRATION
        // =========================
        await RegisteredEvent.deleteOne({ _id: registration._id });

        // =========================
        // 7) RECOMPUTE ATTENDEES (TRUTH)
        // =========================
        const attendeeCount = await RegisteredEvent.countDocuments({
            event_id: eventId,
        });

        const capacityLocked = Boolean(event.capacity_locked);

        const shouldReopen =
            event.status === "Unavailable" &&
            !capacityLocked &&
            attendeeCount < Number(event.max_capacity ?? 0);

        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            {
                $set: {
                    attendees: attendeeCount,
                    status: shouldReopen ? "Available" : event.status,
                },
            },
            { new: true }
        ).lean();

        return res.json({
            success: true,
            code: "UNREGISTER_OK",
            message: "Unregistered successfully",
            event: {
                id: updatedEvent._id.toString(),
                ...updatedEvent,
            },
        });
    } catch (err) {
        console.error("Unregister error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Unregister failed",
        });
    }
});



router.post("/:id/Register", async (req, res) => {
    const session = await mongoose.startSession();

    try {
        // ===== JWT AUTH (inside route) =====
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

        const user = await User.findById(userId).select("role").lean();
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


        const eventId = req.params.id;

        await session.withTransaction(async () => {
            // 1) Load event
            const event = await Event.findById(eventId).session(session);
            if (!event) {
                res.status(404).json({
                    success: false,
                    code: "EVENT_NOT_FOUND",
                    message: "Event not found",
                });
                return;
            }

            // 2) Hard blocks
            if (event.status === "Cancelled" || event.status === "Completed") {
                res.status(409).json({
                    success: false,
                    code: "EVENT_CLOSED",
                    message: "Cannot register for this event",
                });
                return;
            }

            // Stop registering once started
            const now = new Date();
            if (event.start_date && now >= new Date(event.start_date)) {
                res.status(409).json({
                    success: false,
                    code: "EVENT_STARTED",
                    message: "Event already started",
                });
                return;
            }

            // Capacity lock (manual lock by admin)
            if (event.capacity_locked === true) {
                res.status(409).json({
                    success: false,
                    code: "REGISTRATION_LOCKED",
                    message: "Registration is closed for this event",
                });
                return;
            }

            // 3) TRUE ATTENDEE COUNT FROM REGISTERED EVENTS
            const currentCount = await RegisteredEvent.countDocuments({
                event_id: eventId,
            }).session(session);

            if (currentCount >= event.max_capacity) {
                // If DB says full, mark event Unavailable (if not already)
                if (event.status !== "Unavailable") {
                    event.status = "Unavailable";
                    event.attendees = currentCount; // snap to truth
                    await event.save({ session });
                }

                res.status(409).json({
                    success: false,
                    code: "FULL",
                    message: "Event is full",
                });
                return;
            }

            // 4) Duplicate check (user already registered?)
            const existing = await RegisteredEvent.findOne({
                user_id: userId,
                event_id: eventId,
            }).session(session);

            if (existing) {
                res.status(409).json({
                    success: false,
                    code: "ALREADY_REGISTERED",
                    message: "Already registered",
                });
                return;
            }

            // 5) Pre-generate registration _id so QR can use it
            const regObjectId = new mongoose.Types.ObjectId();

            const baseUrl = process.env.QR_BASE_URL || "http://localhost:5173";
            const qrUrl = `${baseUrl}/Organiser/Login?regId=${regObjectId.toString()}`;

            const qrBase64 = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 });

            // 6) Create registration (with _id we generated)
            const registration = await RegisteredEvent.create(
                [
                    {
                        _id: regObjectId,
                        user_id: userId,
                        event_id: eventId,
                        qr_code_ticket: qrBase64,
                        turn_up: false,
                        scanned_at: null,
                    },
                ],
                { session }
            );

            // 7) Recompute attendees from truth (currentCount + 1)
            const newAttendeeCount = currentCount + 1;
            event.attendees = newAttendeeCount;

            if (newAttendeeCount >= event.max_capacity) {
                event.status = "Unavailable";
            }

            await event.save({ session });

            // 8) Response
            res.json({
                success: true,
                code: "REGISTER_OK",
                message: "Registered successfully",
                registration: {
                    id: registration[0]._id.toString(),
                    qr_code_ticket: registration[0].qr_code_ticket,
                    user_id: userId,
                    event_id: eventId,
                },
                event: {
                    id: event._id.toString(),
                    attendees: event.attendees,
                    status: event.status,
                    max_capacity: event.max_capacity,
                },
            });
        });
    } catch (err) {
        // Handle unique index duplicate nicely
        if (err?.code === 11000) {
            return res.status(409).json({
                success: false,
                code: "ALREADY_REGISTERED",
                message: "Already registered",
            });
        }

        console.error("Register error:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Register failed",
        });
    } finally {
        session.endSession();
    }
});



// GET /Events/ApprovalDetails/:regId
// Returns registration + related event + user in one shot (organiser/admin only)
router.get("/ApprovalDetails/:regId", async (req, res) => {
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

        // ===== ROLE GATE =====
        const requester = await User.findById(userId).select("role").lean();
        if (!requester) {
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        const role = requester.role;
        const isAllowed = role === "Organiser" || role === "ADMIN";
        if (!isAllowed) {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Organisers/Admin only",
            });
        }

        // ===== PARAM VALIDATION =====
        const { regId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(regId)) {
            return res.status(400).json({
                success: false,
                code: "INVALID_REG_ID",
                message: "Invalid registration id",
            });
        }

        // ===== FETCH REGISTRATION + POPULATE EVENT + USER =====
        const reg = await RegisteredEvent.findById(regId)
            .populate("event_id", "title image start_date end_date status")
            .populate("user_id", "username student_email")
            .lean();

        if (!reg) {
            return res.status(404).json({
                success: false,
                code: "REGISTRATION_NOT_FOUND",
                message: "Registration not found",
            });
        }

        if (!reg.event_id || !reg.user_id) {
            return res.status(404).json({
                success: false,
                code: "EVENT_OR_USER_NOT_FOUND",
                message: "Event or user not found",
            });
        }

        const eventIdStr = reg.event_id._id.toString();

        // ===============================
        // 1) If already scanned → ALWAYS allow viewing
        // ===============================
        if (reg.turn_up === true) {
            return res.json({
                success: true,
                code: "APPROVAL_DETAILS_OK",
                data: {
                    regID: reg._id.toString(),
                    isScanned: true,
                    scanned_at: reg.scanned_at || null,

                    event: {
                        id: eventIdStr,
                        title: reg.event_id.title,
                        image: reg.event_id.image,
                        start_date: reg.event_id.start_date,
                        end_date: reg.event_id.end_date,
                        status: reg.event_id.status,
                    },

                    user: {
                        id: reg.user_id._id.toString(),
                        username: reg.user_id.username,
                        student_email: reg.user_id.student_email,
                    },
                },
            });
        }

        // ===============================
        // 2) If NOT scanned, and event is Cancelled/Completed →
        //    let frontend show the “event closed” screen
        // ===============================
        if (
            reg.event_id.status === "Cancelled" ||
            reg.event_id.status === "Completed"
        ) {
            return res.json({
                success: true,
                code: "APPROVAL_DETAILS_OK",
                data: {
                    regID: reg._id.toString(),
                    isScanned: false,
                    scanned_at: null,

                    event: {
                        id: eventIdStr,
                        title: reg.event_id.title,
                        image: reg.event_id.image,
                        start_date: reg.event_id.start_date,
                        end_date: reg.event_id.end_date,
                        status: reg.event_id.status, 
                    },

                    user: {
                        id: reg.user_id._id.toString(),
                        username: reg.user_id.username,
                        student_email: reg.user_id.student_email,
                    },
                },
            });
        }

        // ===============================
        // 3) Time window: 15min before start to 1h after end
        //    (only for non-scanned, non-cancelled, non-completed)
        // ===============================
        const now = new Date();

        const start = reg.event_id.start_date
            ? new Date(reg.event_id.start_date)
            : null;
        const end = reg.event_id.end_date
            ? new Date(reg.event_id.end_date)
            : null;

        const EARLY_MINUTES = 15;
        const LATE_MINUTES = 60;

        const openAt = start
            ? new Date(start.getTime() - EARLY_MINUTES * 60 * 1000)
            : null;
        const closeAt = end
            ? new Date(end.getTime() + LATE_MINUTES * 60 * 1000)
            : null;

        if (openAt && now < openAt) {
            return res.status(409).json({
                success: false,
                code: "APPROVAL_TOO_EARLY",
                message: "Attendance approval is not available yet.",
            });
        }

        if (closeAt && now > closeAt) {
            return res.status(409).json({
                success: false,
                code: "APPROVAL_TOO_LATE",
                message: "Attendance approval window has closed.",
            });
        }

        // ===============================
        // 4) Normal success (inside allowed window)
        // ===============================
        return res.json({
            success: true,
            code: "APPROVAL_DETAILS_OK",
            data: {
                regID: reg._id.toString(),
                isScanned: false,
                scanned_at: null,

                event: {
                    id: eventIdStr,
                    title: reg.event_id.title,
                    image: reg.event_id.image,
                    start_date: reg.event_id.start_date,
                    end_date: reg.event_id.end_date,
                    status: reg.event_id.status,
                },

                user: {
                    id: reg.user_id._id.toString(),
                    username: reg.user_id.username,
                    student_email: reg.user_id.student_email,
                },
            },
        });
    } catch (err) {
        console.error("Error in GET /Events/ApprovalDetails/:regId", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Cannot fetch approval details",
        });
    }
});


// POST /Events/ApprovalEvents/:regId
// - Organiser/Admin only
// - Marks registration as attended
// - Awards points (with 5000 cap on current points)
// - Updates total_points
// - Awards badges (using RegisteredEvent as SOT)
// - Sends Notifications (Points + Badge + cap info)
router.post("/ApprovalEvents/:regId", async (req, res) => {
    const session = await mongoose.startSession();

    try {
        // ===== JWT CHECK =====
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            session.endSession();
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
            session.endSession();
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
            });
        }

        const userId = payload.user_id;
        if (!userId) {
            session.endSession();
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Token missing user id",
            });
        }

        // ===== ROLE GATE: Organiser / Admin only =====
        const requester = await User.findById(userId).select("role").lean();
        if (!requester) {
            session.endSession();
            return res.status(404).json({
                success: false,
                code: "USER_NOT_FOUND",
                message: "User not found",
            });
        }

        const role = requester.role;
        const isAllowed = role === "Organiser" || role === "ADMIN";
        if (!isAllowed) {
            session.endSession();
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Organisers/Admin only",
            });
        }

        // ===== PARAM VALIDATION =====
        const { regId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(regId)) {
            session.endSession();
            return res.status(400).json({
                success: false,
                code: "INVALID_REG_ID",
                message: "Invalid registration id",
            });
        }

        await session.withTransaction(async () => {
            // ===== FETCH REGISTRATION =====
            const reg = await RegisteredEvent.findById(regId).session(session);
            if (!reg) {
                res.status(404).json({
                    success: false,
                    code: "REGISTRATION_NOT_FOUND",
                    message: "Registration not found",
                });
                return;
            }

            // Already approved?
            if (reg.turn_up) {
                res.status(409).json({
                    success: false,
                    code: "ALREADY_APPROVED",
                    message: "Attendance already approved for this registration",
                });
                return;
            }

            // ===== FETCH EVENT + USER =====
            const [event, user] = await Promise.all([
                Event.findById(reg.event_id).session(session),
                User.findById(reg.user_id).session(session),
            ]);

            if (!event || !user) {
                res.status(404).json({
                    success: false,
                    code: "EVENT_OR_USER_NOT_FOUND",
                    message: "Event or user not found",
                });
                return;
            }

            // ===== STATUS CHECK (Completed / Cancelled) =====
            if (event.status === "Cancelled" || event.status === "Completed") {
                res.status(409).json({
                    success: false,
                    code: "EVENT_CLOSED",
                    message: `Cannot approve attendance for a ${event.status} event`,
                });
                return;
            }

            // ===== SERVER-SIDE TIME WINDOW CHECK =====
            // Same logic as GET /ApprovalDetails:
            // From 15min before start until 1h after end.
            const now = new Date();

            const start = event.start_date ? new Date(event.start_date) : null;
            const end = event.end_date ? new Date(event.end_date) : null;

            const EARLY_MINUTES = 15;
            const LATE_MINUTES = 60;

            const openAt = start
                ? new Date(start.getTime() - EARLY_MINUTES * 60 * 1000)
                : null;
            const closeAt = end
                ? new Date(end.getTime() + LATE_MINUTES * 60 * 1000)
                : null;

            if (openAt && now < openAt) {
                res.status(409).json({
                    success: false,
                    code: "APPROVAL_TOO_EARLY",
                    message: "Attendance approval is not available yet.",
                });
                return;
            }

            if (closeAt && now > closeAt) {
                res.status(409).json({
                    success: false,
                    code: "APPROVAL_TOO_LATE",
                    message: "Attendance approval window has closed.",
                });
                return;
            }

            // ===== POINTS LOGIC (with 5000 cap for current points) =====
            const eventPoints = Number(event.points) || 0;
            const currentPoints = Number(user.points) || 0;
            const currentTotal = Number(user.total_points) || 0;

            let awardedPoints = 0;
            let responseMessage = "Attendance approved.";
            let pointsMessageForNotif = null; // what the user will see in Notification

            if (eventPoints > 0) {
                const spaceLeft = Math.max(0, POINTS_CAP - currentPoints);
                awardedPoints = Math.min(eventPoints, spaceLeft);

                // Lifetime total always gets full event points
                user.total_points = currentTotal + eventPoints;

                if (awardedPoints > 0) {
                    user.points = currentPoints + awardedPoints;

                    if (awardedPoints < eventPoints) {
                        responseMessage =
                            `Attendance approved. You earned ${awardedPoints} points (capped at ${POINTS_CAP}).`;
                        pointsMessageForNotif =
                            `You earned ${awardedPoints} points for attending "${event.title}", but your current points are capped at ${POINTS_CAP}.`;
                    } else {
                        responseMessage =
                            `Attendance approved. You earned ${awardedPoints} points.`;
                        pointsMessageForNotif =
                            `You earned ${awardedPoints} points for attending "${event.title}". Redeem some rewards today!`;
                    }
                } else {
                    // Already at cap, no current points given
                    user.points = currentPoints; // unchanged
                    responseMessage =
                        `Attendance approved. No points awarded because you are already at the ${POINTS_CAP} points cap.`;
                    pointsMessageForNotif =
                        `Your attendance for "${event.title}" was recorded, but no points were awarded because you are already at the ${POINTS_CAP} points cap.`;
                }
            } else {
                // No points for this event
                user.points = currentPoints;
                user.total_points = currentTotal;
            }

            // ===== MARK ATTENDANCE (RegisteredEvent is SOT) =====
            reg.turn_up = true;
            reg.scanned_at = now;

            // Save registration first so badge helper sees this attendance
            await reg.save({ session });

            // ===== BADGES (using RegisteredEvent inside helper) =====
            const newlyEarnedBadges = await awardBadgesForUser(user, session);

            // Now save user with updated points + badges
            await user.save({ session });


            // ===== NOTIFICATIONS =====
            const notificationsToInsert = [];

            // Points notification (only if a message is set)
            if (pointsMessageForNotif) {
                notificationsToInsert.push({
                    user: user._id,
                    type: "Profile",
                    message: pointsMessageForNotif, // includes cap info if capped
                    points_added: awardedPoints,
                    icon: "/notifications/points.png",
                });
            }

            // Badge notifications
            newlyEarnedBadges.forEach((b) => {
                notificationsToInsert.push({
                    user: user._id,
                    type: "Badge",
                    message: `You earned the "${b.name}" badge!`,
                    icon: "/notifications/badges.png",
                });
            });

            if (notificationsToInsert.length > 0) {
                await Notification.insertMany(notificationsToInsert, { session });
            }

            // ===== RESPONSE (organiser sees; student sees via notif) =====
            res.json({
                success: true,
                code: "ATTENDANCE_APPROVED",
                message: responseMessage,
                points_awarded: awardedPoints,
                badges_awarded: newlyEarnedBadges,
                registration: {
                    id: reg._id.toString(),
                    turn_up: reg.turn_up,
                    scanned_at: reg.scanned_at,
                },
            });
        });
    } catch (err) {
        console.error("Error in POST /Events/ApprovalEvents/:regId", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Failed to approve attendance",
        });
    } finally {
        session.endSession();
    }
});







export default router;
