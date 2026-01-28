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
   POST /Users/login-student
   ========================= */
router.post("/Login_User", async (req, res) => {
    try {
        // Safely handle missing body
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required",
            });
        }

        const user = await User.findOne({
            student_email: email.toLowerCase(),
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Incorrect Email or Password",
            });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(400).json({
                success: false,
                message: "Incorrect Email or Password",
            });
        }

        if (user.role !== "Student") {
            return res.status(403).json({
                success: false,
                message: "Please login via the organiser portal",
            });
        }

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
            message: "Server error",
        });
    }
});


/* =========================
   2) ORGANISER LOGIN
   POST /Users/login-organiser
   ========================= */
router.post("/Login_Organiser", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({
                success: false,
                message: "Email and password are required",
            });
        }

        const user = await User.findOne({
            student_email: email.toLowerCase(),
        });
        if (!user) {
            return res.json({
                success: false,
                message: "Incorrect email or password",
            });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.json({
                success: false,
                message: "Incorrect email or password",
            });
        }

        if (user.role !== "Organiser" && user.role !== "ADMIN") {
            return res.json({
                success: false,
                message: "This portal is for organisers only",
            });
        }

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
            message: "Server error",
        });
    }
});

/* =========================
   3) ADMIN LOGIN
   POST /Users/login-admin
   ========================= */
router.post("/Login_Admin", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({
                success: false,
                message: "Email and password are required",
            });
        }

        const user = await User.findOne({
            student_email: email.toLowerCase(),
        });
        if (!user) {
            return res.json({
                success: false,
                message: "Email or Password is incorrect",
            });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.json({
                success: false,
                message: "Email or Password is incorrect",
            });
        }

        if (user.role !== "ADMIN") {
            return res.json({
                success: false,
                message: "This portal is for administrators only",
            });
        }

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
        console.error("Error in /User/Login_Admin:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
});

/* =========================
   4) LEADERBOARD
   GET /Users/leaderboard
   ========================= */

// Check this route again: How does this route know which student is sending the data? //
// GET /Users/Leaderboards
// router.get("/Leaderboards", async (req, res) => {
//     try {
//         // =========================
//         // 0) OPTIONAL JWT (INLINE)
//         // =========================
//         let meId = null;

//         const authHeader = req.headers.authorization;
//         if (authHeader?.startsWith("Bearer ")) {
//             const token = authHeader.split(" ")[1];
//             try {
//                 const { payload } = await jwtVerify(token, secret);
//                 if (payload?.user_id) meId = String(payload.user_id);
//             } catch {
//                 // token invalid -> just don't highlight, but still return leaderboard
//                 meId = null;
//             }
//         }

//         // =========================
//         // 1) Leaderboard data
//         // =========================
//         const students = await User.find({ role: "Student" }).lean();

//         const activeStudents = students.filter(
//             (u) => u.createdAt && typeof u.total_points === "number"
//         );

//         const allZeroPoints =
//             activeStudents.length > 0 &&
//             activeStudents.every((u) => (u.total_points ?? 0) === 0);

//         activeStudents.sort((a, b) => {
//             const diff = (b.total_points ?? 0) - (a.total_points ?? 0);
//             if (diff !== 0) return diff;
//             return a.username.localeCompare(b.username);
//         });

//         const mapUser = (u) => ({
//             id: u._id.toString(),
//             username: u.username,
//             student_email: u.student_email,
//             profile_image: u.profile_image,
//             total_points: u.total_points,
//         });

//         return res.json({
//             success: true,
//             meId, // for frontend highlight
//             top3: activeStudents.slice(0, 3).map(mapUser),
//             rest: activeStudents.slice(3).map(mapUser),
//             allZeroPoints,
//         });
//     } catch (err) {
//         console.error("Error in /Users/Leaderboards:", err);
//         return res.status(500).json({ success: false, message: "Server error" });
//     }
// });

// GET /Users/Leaderboards
router.get("/Leaderboards", async (req, res) => {
    try {
        // =========================
        // 0) OPTIONAL JWT (INLINE)
        // =========================
        let meId = null;

        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            try {
                const { payload } = await jwtVerify(token, secret);
                if (payload?.user_id) meId = String(payload.user_id);
            } catch {
                meId = null; // invalid token -> just no highlight
            }
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
   GET /Users/:id
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
