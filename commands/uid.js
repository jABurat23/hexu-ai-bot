module.exports = {
  name: "uid",
  category: "User",
  description: "Display your Messenger user ID.",
  handler: async (user) => `Your Messenger user ID is: ${user.psid}`,
};
