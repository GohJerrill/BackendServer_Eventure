// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import User from "../Models/UserModel.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();


const rawSecret = process.env.JWT_SECRET;
const secret = new TextEncoder().encode(rawSecret.trim());


// Helper: convert Mongoose doc -> plain object without password, with id instead of _id
function toClientUser(userDoc) {
    const obj = userDoc.toObject();
    const { _id, password, __v, ...rest } = obj;
    return { id: _id.toString(), ...rest };
}

/* =========================
   1) STUDENT LOGIN
   POST /User/Login_User
   ========================= */
router.post("/Login_User", async (req, res) => {
    try {
        // Safely handle missing body
        const { email, password } = req.body || {};

        // ---------- Basic type + empty checks ----------
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "Email and password are required",
            });
        }

        const trimmedEmail = email.trim().toLowerCase();
        const trimmedPassword = password.trim();

        if (!trimmedEmail || !trimmedPassword) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "Email and password are required",
            });
        }

        // ---------- Student email validation (mirror frontend + schema) ----------
        const domain = "@student.tp.edu.sg";

        if (!trimmedEmail.endsWith(domain)) {
            return res.status(400).json({
                success: false,
                code: "INVALID_EMAIL_DOMAIN",
                message: "Please input a valid School Email Address",
            });
        }

        const prefix = trimmedEmail.slice(0, -domain.length); // before @student.tp.edu.sg
        if (prefix.length !== 8) {
            return res.status(400).json({
                success: false,
                code: "INVALID_EMAIL_FORMAT",
                message: "Please input a valid School Email Address",
            });
        }

        // ---------- Look up user ----------
        const user = await User.findOne({
            student_email: trimmedEmail,
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                code: "INVALID_CREDENTIALS",
                message: "Incorrect Email or Password",
            });
        }

        // ---------- Role gate: Students only ----------
        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "Please login via the organiser portal",
            });
        }

        // ---------- Password check ----------
        const match = await bcrypt.compare(trimmedPassword, user.password);
        if (!match) {
            return res.status(401).json({
                success: false,
                code: "INVALID_CREDENTIALS",
                message: "Incorrect Email or Password",
            });
        }

        // ---------- Issue JWT ----------
        const token = await new SignJWT({
            user_id: user._id.toString(),
            email: user.student_email,
            role: user.role,
            points: user.points,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("3d")
            .sign(secret);

        return res.json({
            success: true,
            user: toClientUser(user),
            JWTToken: token,
        });
    } catch (err) {
        console.error("Error in Logging in User:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});



/* =========================
   2) ORGANISER LOGIN
   POST /User/Login_Organiser
   ========================= */
router.post("/Login_Organiser", async (req, res) => {
    try {
        // Safely handle missing body
        const { email, password } = req.body || {};

        // ---------- Basic type + empty checks ----------
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "Email and password are required",
            });
        }

        const trimmedEmail = email.trim().toLowerCase();
        const trimmedPassword = password.trim();

        if (!trimmedEmail || !trimmedPassword) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "Email and password are required",
            });
        }

        // ---------- Look up user by email ----------
        const user = await User.findOne({
            student_email: trimmedEmail,
        });

        if (!user) {
            // Generic so attackers can't tell if email exists
            return res.status(401).json({
                success: false,
                code: "INVALID_CREDENTIALS",
                message: "Incorrect email or password",
            });
        }

        // ---------- Password check ----------
        const match = await bcrypt.compare(trimmedPassword, user.password);
        if (!match) {
            return res.status(401).json({
                success: false,
                code: "INVALID_CREDENTIALS",
                message: "Incorrect email or password",
            });
        }

        // ---------- Role gate: Organiser or ADMIN only ----------
        if (user.role !== "Organiser" && user.role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "This portal is for organisers only",
            });
        }

        // ---------- Issue JWT ----------
        const token = await new SignJWT({
            user_id: user._id.toString(),
            email: user.student_email,
            role: user.role,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("1d")
            .sign(secret);

        return res.json({
            success: true,
            user: toClientUser(user),
            JWTToken: token,
        });
    } catch (err) {
        console.error("Error in /User/Login_Organiser:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});

/* =========================
   3) ADMIN LOGIN
   POST /User/Login-Admin
   ========================= */
/* =========================
   3) ADMIN LOGIN
   POST /Users/Login_Admin
   ========================= */
router.post("/Login_Admin", async (req, res) => {
    try {
        // Safely handle missing body
        const { email, password } = req.body || {};

        // ---------- Basic type + empty checks ----------
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "Email and password are required",
            });
        }

        const trimmedEmail = email.trim().toLowerCase();
        const trimmedPassword = password.trim();

        if (!trimmedEmail || !trimmedPassword) {
            return res.status(400).json({
                success: false,
                code: "BAD_REQUEST",
                message: "Email and password are required",
            });
        }

        // ---------- Look up user by email ----------
        const user = await User.findOne({
            student_email: trimmedEmail,
        });

        if (!user) {
            // generic so we don't leak if email exists
            return res.status(401).json({
                success: false,
                code: "INVALID_CREDENTIALS",
                message: "Email or password is incorrect",
            });
        }

        // ---------- Password check ----------
        const match = await bcrypt.compare(trimmedPassword, user.password);
        if (!match) {
            return res.status(401).json({
                success: false,
                code: "INVALID_CREDENTIALS",
                message: "Email or password is incorrect",
            });
        }

        // ---------- Role gate: ADMIN only ----------
        const role = String(user.role || "").toUpperCase();
        if (role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "This portal is for administrators only",
            });
        }

        // ---------- Issue JWT ----------
        const token = await new SignJWT({
            user_id: user._id.toString(),
            email: user.student_email,
            role: user.role,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("1d")
            .sign(secret);

        return res.json({
            success: true,
            user: toClientUser(user),
            JWTToken: token,
        });
    } catch (err) {
        console.error("Error in /Users/Login_Admin:", err);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            message: "Server error",
        });
    }
});

// GET /User/Leaderboards
router.get("/Leaderboards", async (req, res) => {
    try {
        // =========================
        // 0) JWT (INLINE)
        // =========================
        let meId = null;

        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            try {
                const { payload } = await jwtVerify(token, secret);
                if (payload?.user_id) meId = String(payload.user_id);
            } catch {
                meId = null;
            }
        }

        // If meId is weird, ignore it
        if (meId && !mongoose.Types.ObjectId.isValid(meId)) {
            meId = null;
        }

        // =========================
        // 1) allZeroPoints (across ALL students)
        // =========================
        const totalStudents = await User.countDocuments({ role: "Student" });

        const anyPositive = await User.countDocuments({
            role: "Student",
            total_points: { $gt: 0 },
        });

        const allZeroPoints = totalStudents > 0 && anyPositive === 0;

        // =========================
        // 2) Top 50 (DB sort + limit)
        // =========================
        const top50 = await User.find({ role: "Student" })
            .sort({ total_points: -1, username: 1 })
            .limit(50)
            .select("_id username student_email profile_image total_points")
            .lean();

        const mapUser = (u) => ({
            id: String(u._id),
            username: u.username,
            student_email: u.student_email,
            profile_image: u.profile_image,
            total_points: u.total_points ?? 0,
        });

        const top3 = top50.slice(0, 3).map(mapUser);
        const rest = top50.slice(3).map(mapUser);

        // =========================
        // 3) Compute meRank (even if not in top50)
        // =========================
        let me = null;

        if (meId) {
            const meDoc = await User.findById(meId)
                .select("_id role username student_email profile_image total_points")
                .lean();

            // only students have leaderboard rank
            if (meDoc && String(meDoc.role).toLowerCase() === "student") {
                const myPoints = meDoc.total_points ?? 0;
                const myUsername = meDoc.username ?? "";

                // rank = (# users ahead of me) + 1
                // ahead = higher points OR (same points AND username comes earlier)
                const aheadCount = await User.countDocuments({
                    role: "Student",
                    $or: [
                        { total_points: { $gt: myPoints } },
                        { total_points: myPoints, username: { $lt: myUsername } },
                    ],
                });

                me = {
                    id: String(meDoc._id),
                    username: meDoc.username,
                    student_email: meDoc.student_email,
                    profile_image: meDoc.profile_image,
                    total_points: myPoints,
                    rank: allZeroPoints ? "-" : aheadCount + 1,
                };
            }
        }

        return res.json({
            success: true,
            meId,          // for highlight if in list
            me,            // for "Your rank" even if outside top50
            top3,
            rest,
            allZeroPoints,
            totalStudents,
            limit: 50,
        });
    } catch (err) {
        console.error("Error in /Users/Leaderboards:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});



/* =========================
   5) GET USER BY ID
   GET /User/:id
   (used by RefreshCurrentUser)
   ========================= */
router.get("/Refresh", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const token = authHeader.split(" ")[1];
        const { payload } = await jwtVerify(token, secret);

        const user = await User.findById(payload.user_id);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Session expired",
            });
        }

        return res.json({
            success: true,
            user: toClientUser(user),
        });
    } catch (err) {
        console.error("Error in GET /User/Refresh:", err);
        return res.status(401).json({
            success: false,
            message: "Invalid token",
        });
    }
});

export default router;
