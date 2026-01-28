// models/Notification.js
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
        // Which user this notification belongs to
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // "Event", "Points", or "Badges"
        type: {
            type: String,
            enum: ["Event", "Points", "Badge", "Season_Reset", "Profile"],
            required: true,
        },

        // Text shown in the UI
        message: {
            type: String,
            required: true,
            trim: true,
        },

        // For Event-type notifications (e.g. event updated)
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: function () {
                return this.type === "Event";
            },
        },

        // For Points-type notifications
        points_added: {
            type: Number,
            min: 0,
            required: function () {
                return this.type === "Points";
            },
        },

        // Has the user opened / read this notification?
        is_read: {
            type: Boolean,
            default: false,
        },

        // Icon path, e.g. "/notifications/points.png"
        icon: {
            type: String,
            required: true,
            trim: true,
        },
    },
    {
        // createdAt = when notification was created (your old created_at)
        // updatedAt = last time it changed (e.g. is_read toggled)
        timestamps: true,
    }
);


notificationSchema.index({ user: 1, is_read: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
