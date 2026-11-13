const validateWebsite = {
  validate: (value) => {
    if (!value) return true;

    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) ||
        "Enter a valid website URL"
      );
    } catch {
      return "Enter a valid website URL";
    }
  },
};

export { validateWebsite };
