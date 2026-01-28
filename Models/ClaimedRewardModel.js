// models/ClaimedReward.js
import mongoose from "mongoose";

const claimedRewardSchema = new mongoose.Schema(
    {
        // Who claimed the reward
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // Which reward was claimed
        reward: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Reward",
            required: true,
        },
    },
    {
        timestamps: true, // createdAt, updatedAt
    }
);

const ClaimedReward = mongoose.model("ClaimedReward", claimedRewardSchema);

export default ClaimedReward;
