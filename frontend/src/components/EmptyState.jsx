const EmptyState = ({ title, description, icon }) => {
  return (
    <div
      className="text-center py-14 rounded-2xl"
      style={{ background: "white", border: "1px solid rgba(27,43,74,0.1)" }}
    >
      <div
        className="mx-auto flex items-center justify-center h-14 w-14 rounded-full mb-4"
        style={{ background: "rgba(200,169,81,0.14)", color: "#A9863A" }}
      >
        {icon}
      </div>
      <h3 className="text-xl font-normal mb-1" style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}>
        {title}
      </h3>
      <p className="max-w-md mx-auto text-sm" style={{ color: "#4A5568" }}>{description}</p>
    </div>
  );
};

export default EmptyState;
