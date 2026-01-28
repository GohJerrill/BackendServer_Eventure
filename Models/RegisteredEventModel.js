// models/RegisteredEvent.js
import mongoose from "mongoose";

const registeredEventSchema = new mongoose.Schema(
    {
        // Which user registered
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // Which event they registered for
        event_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true,
        },


        // Base64 QR code string
        qr_code_ticket: {
            type: String,
            required: true,
        },

        // Did they actually turn up?
        turn_up: {
            type: Boolean,
            default: false,
        },

        // When QR was scanned at the door (can be null)
        scanned_at: {
            type: Date,
            default: null,
            validate: {
                validator: function (value) {
                    if (!value) return true;
                    // use createdAt from timestamps instead of date_registered
                    if (!this.createdAt) return true;
                    return value >= this.createdAt;
                },
                message: "Scanned time cannot be before registration time",
            },
        },
    },
    {
        timestamps: true, // createdAt, updatedAt
    }
);

// Prevent same user registering for same event twice
registeredEventSchema.index({ user_id: 1, event_id: 1 }, { unique: true });

const RegisteredEvent = mongoose.model(
    "RegisteredEvent",
    registeredEventSchema
);

export default RegisteredEvent;
