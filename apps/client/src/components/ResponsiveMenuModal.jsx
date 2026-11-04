const direction = {
  left: { side: "left-0", translate: "-translate-x-full" },
  right: { side: "right-0", translate: "translate-x-full" },
};

const ResponsiveMenuModal = ({
  isOpen,
  onClose,
  sideModal,
  sideModalClass = "lg:hidden min-w-65",
  modalOpenDirection = "left",
}) => {
  return (
    <>
      {/* BACKDROP (mobile only) */}
      <div
        onClick={onClose}
        className={`lg:hidden fixed inset-0 z-40 bg-black/30 transition-opacity duration-300
        ${isOpen ? "opacity-100 visible" : "opacity-0 invisible"}`}
      />

      {/* Side Menu (mobile only) */}
      <aside
        className={`
        ${sideModalClass}
        ${direction[modalOpenDirection].side}
        fixed top-0 z-50
        h-full bg-white text-black
        transform transition-transform duration-300
        ${isOpen ? "translate-x-0" : direction[modalOpenDirection].translate}`}
      >
        {sideModal}
      </aside>
    </>
  );
};

export default ResponsiveMenuModal;
