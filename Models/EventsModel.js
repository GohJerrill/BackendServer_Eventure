// models/Event.js
import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
    {
        // We let MongoDB handle _id (no need for "id": "E001")

        title: {
            type: String,
            required: true,
            trim: true,
            minlength: 3,
            maxlength: 200,
        },

        description: {
            type: String,
            required: true,
        },

        school: {
            type: String,
            required: true,
            trim: true,
            enum: ["DES", "BUS", "ASC", "IIT", "TP", "ENG", "HSS"],
        },

        category: {
            type: String,
            required: true,
            trim: true,
            enum: [
                "Social Events",
                "Conference",
                "Science",
                "Arts",
                "Sports",
                "Technology",
                "Charity",
            ],
        },


        type: {
            type: String,
            required: true,
            enum: ["Face to face", "Online"],
        },

        start_date: {
            type: Date,
            required: true,
            validate: {
                validator: function (value) {
                    if (this.status !== "Available") return true;

                    if (!value) return true;
                    const now = new Date();

                    return value > now; // for new Available events, must be in future
                },
                message: "Start date must be in the future for available events",
            },
        },


        end_date: {
            type: Date,
            required: true,
            validate: {
                validator: function (value) {
                    if (!this.start_date || !value) return true;
                    return value > this.start_date;
                },
                message: "End date must be greater than start date",
            },
        },

        status: {
            type: String,
            required: true,
            enum: ["Available", "Unavailable", "Completed", "Cancelled"],
            default: "Available",
        },

        organiser: {
            type: String,
            required: true,
            trim: true,
        },

        venue: {
            type: String,
            required: true,
            trim: true,
        },

        attendees: {
            type: Number,
            default: 0,
            min: 0,
        },

        capacity_locked: {
            type: Boolean,
            default: false,
        },


        max_capacity: {
            type: Number,
            required: true,
            min: 1,
        },

        points: {
            type: Number,
            default: 0,
            min: 0,
        },

        TP_Location: {
            type: Boolean,
            default: true,
        },

        image: {
            type: String,
            required: true,
            trim: true,
        },

        organiser_image: {
            type: String,
            required: true,
            trim: true,
        },

    },
    {
        timestamps: true, // createdAt, updatedAt
    }
);

const Event = mongoose.model("Event", eventSchema);

export default Event;
