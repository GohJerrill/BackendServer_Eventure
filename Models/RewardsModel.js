// models/Reward.js
import mongoose from "mongoose";

const rewardSchema = new mongoose.Schema(
    {
        // Display name of the reward
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },

        // Cost in Eventure points
        cost: {
            type: Number,
            required: true,
            min: 0,
        },

        // How many left
        stock: {
            type: Number,
            required: true,
            min: 0,
        },

        // Image shown in the app rewards page
        reward_image: {
            type: String,
            required: true,
            trim: true,
        },

        // Longer description in the app
        description: {
            type: String,
            required: true,
            trim: true,
        },

        // Image used inside the email voucher
        reward_email_image: {
            type: String,
            required: true,
            trim: true,
        },

        // Text inside the email voucher
        email_description: {
            type: String,
            required: true,
            trim: true,
        },
    },
    {
        timestamps: true, 
    }
);

const Reward = mongoose.model("Reward", rewardSchema);

export default Reward;
