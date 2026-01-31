// models/ClaimedReward.js
/*
This is the history log for the user to view where his claimed rewards has gone to. Its a history page to display every reward redeemed.
*/
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
