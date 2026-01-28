// models/Badge.js
import mongoose from "mongoose";

const badgeSchema = new mongoose.Schema(
    {
        badgeId: {          
            type: String,
            required: true,
            unique: true,
            trim: true,            
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        description: {
            type: String,
            required: true,
            trim: true,
        },

        // e.g. "/badges/BadgeBABY.png"
        icon_image: {
            type: String,
            required: true,
            trim: true,
        },
    },
);

const Badge = mongoose.model("Badge", badgeSchema);

export default Badge;
