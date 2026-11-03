export async function restoreAuthenticatedUser(requestSession) {
  try {
    const data = await requestSession();
    return data?.user || null;
  } catch (error) {
    if (error?.status === 401 || error?.code === "unauthorized") return null;
    throw error;
  }
}
