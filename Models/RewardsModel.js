// models/Reward.js
/* This is the rewards model collection for users to use their points and spent it here. When users spent their points, the backend
will first check if the user has enough points. If the user has enough points the redemption go through, emailing the user of the 
reward description and deducting the right points away from the user.*/
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
