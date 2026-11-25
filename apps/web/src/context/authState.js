export async function restoreAuthenticatedUser(requestSession) {
  try {
    const result = await requestSession();
    return result?.data?.user || null;
  } catch (error) {
    if (
      error?.statusCode === 401 &&
      ["unauthorized", "invalid"].includes(error?.errors?.[0]?.code)
    ) return null;
    throw error;
  }
}
