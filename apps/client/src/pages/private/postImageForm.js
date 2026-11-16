const selectImageFileState = ({ file }) => ({
  imageFile: file || null,
  imageUrl: "",
});

const enterImageUrlState = ({ value }) => ({
  imageFile: null,
  clearNativeFile: Boolean(String(value || "").trim()),
});

export { selectImageFileState, enterImageUrlState };
