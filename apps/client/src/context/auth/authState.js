export async function restoreAuthenticatedUser(requestSession) {
  try {
    const response = await requestSession();
    return response?.data?.user ?? response?.user ?? null;
  } catch (error) {
    if (error?.response?.status === 401 || error?.status === 401) return null;
    throw error;
  }
}
