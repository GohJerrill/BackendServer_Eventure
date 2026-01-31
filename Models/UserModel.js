// models/User.js
import mongoose from "mongoose";


// Subdocument for earned badges
const earnedBadgeSchema = new mongoose.Schema(
    {
        badge: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Badge",
            required: true,
        },
    },
    {
        _id: false,
        timestamps: true
    }
);

const userSchema = new mongoose.Schema(
    {
        // Use Mongoose ID over here EHHEEHEH"

        username: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 100,
        },

        student_email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            validate: {
                validator: function (value) {
                    if (this.role !== "Student") return true;

                    const domain = "@student.tp.edu.sg";

                    if (!value.endsWith(domain)) {
                        return false;
                    }

                    const prefix = value.slice(0, -domain.length);
                    return prefix.length === 8;
                },
                message: "Please input a valid School Email Address",
            },
        },

        password: {
            type: String,
            required: true,
        },

        role: {
            type: String,
            enum: ["Student", "Organiser", "ADMIN"],
            default: "Student",
            required: true,
        },

        profile_image: {
            type: String,
            default: null, // e.g. "/user_profile/UserBABY.png"
        },

        // Current points (e.g. this month / active)
        /*Even  though this can be placed in a seperate collection I have decided to place it here for clarity and
        transparency. The users can be able to view which events they joined which in turn earn points, and which
        rewards they redeem in the claimed rewards history field. However there is some limitations of course
        this is not a full ledger and audit trail, however a points log is not needed in our application and would cost issues.
        */
        points: {
            type: Number,
            default: 0,
            min: 0,
            max: 5000,
        },

        /* 
        I have added a cap of 5000, because I dont want the user to abuse the system by hoarding a tons of points, redeeming
        everything which can break and make the system useless.

        */

        // Lifetime or total points (based on your logic)
        total_points: {
            type: Number,
            default: 0,
            min: 0,
        },

        // Earned badges (reference + date)
        badges: [earnedBadgeSchema],
    },
    {
        timestamps: true,
    }
);

const User = mongoose.model("User", userSchema);

export default User;
