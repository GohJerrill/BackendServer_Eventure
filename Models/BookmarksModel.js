// models/Bookmark.js
import mongoose from "mongoose";

const bookmarkSchema = new mongoose.Schema(
    {
        // Who bookmarked
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // Which event is bookmarked
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true,
        },
    },
    // {
    //     timestamps: true, // createdAt = when it was bookmarked
    // }
);

// User cannot bookmark the same event twice
bookmarkSchema.index({ user: 1, event: 1 }, { unique: true });

const Bookmark = mongoose.model("Bookmark", bookmarkSchema);

export default Bookmark;
