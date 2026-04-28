cmake_minimum_required(VERSION 3.10)
project(AkshayBhojanam)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find required packages
find_package(SQLite3 REQUIRED)

# Crow is header-only, include from local directory
set(CROW_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/include)

# Main executable
add_executable(server main.cpp)

# Include directories
target_include_directories(server PRIVATE ${CMAKE_SOURCE_DIR})
target_include_directories(server PRIVATE ${CROW_INCLUDE_DIR})

# Link libraries
target_link_libraries(server PRIVATE SQLite::SQLite3)

# Platform-specific settings
if(MSVC)
    target_compile_options(server PRIVATE /W4)
else()
    target_compile_options(server PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Windows socket library
if(WIN32)
    target_link_libraries(server PRIVATE ws2_32 wsock32)
endif()
